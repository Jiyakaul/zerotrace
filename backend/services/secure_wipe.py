"""
Secure Wipe Service - NIST 800-88 Compliant Data Erasure
"""

import os
import time
import ctypes
import hashlib
import subprocess
import platform
import secrets
from typing import Optional, Dict, Any, Callable
from enum import Enum
import logging
from .wipe_methods import WipeMethods

logger = logging.getLogger(__name__)

# Device *introspection* shells out once per drive. Without a cap, /api/drives
# could take longer than the frontend's 8s abort and the device list would come
# back empty. Wipe operations themselves are deliberately not bounded by this.
PROBE_TIMEOUT_SECONDS = 3

class WipeMethod(Enum):
    NIST_800_88 = "nist_800_88"
    DOD_5220_22_M = "dod_5220_22_m"
    GUTMANN = "gutmann"
    CRYPTO_ERASE = "crypto_erase"
    ATA_SANITIZE = "ata_sanitize"
    NVME_FORMAT = "nvme_format"
    SINGLE_PASS = "single_pass"
    THREE_PASS = "three_pass"

def classify_wipe_exception(exc: Exception) -> Dict[str, Any]:
    """Turn an exception from the wipe engine into structured error fields.

    Every failure gets a category so the UI can name the real problem. The
    "administrator required" message is reserved for genuine privilege failures
    and is otherwise never shown - previously every failure, including a ctypes
    OverflowError, was reported to the user as a missing Administrator token.
    """
    from services.wipe_methods import WipeOperationError

    if isinstance(exc, WipeOperationError):
        return {
            "error_category": exc.category,
            "error_operation": exc.operation,
            "win32_error": exc.win32_error,
            "error_offset": exc.offset,
        }

    # ctypes argument-conversion problems surface as ArgumentError/OverflowError
    # and are implementation bugs, not privilege or hardware problems.
    if isinstance(exc, (ctypes.ArgumentError, OverflowError)):
        return {
            "error_category": "internal_win32",
            "error_operation": "ctypes argument conversion",
            "win32_error": None,
            "error_offset": None,
        }

    if isinstance(exc, PermissionError):
        return {"error_category": "admin_required", "error_operation": "device access",
                "win32_error": getattr(exc, "winerror", None), "error_offset": None}

    if isinstance(exc, FileNotFoundError):
        return {"error_category": "device_open_failed", "error_operation": "open device",
                "win32_error": getattr(exc, "winerror", None), "error_offset": None}

    if isinstance(exc, OSError):
        return {"error_category": "internal_win32", "error_operation": "device I/O",
                "win32_error": getattr(exc, "winerror", None), "error_offset": None}

    return {"error_category": "wipe_failed", "error_operation": "",
            "win32_error": None, "error_offset": None}


class SecureWipeService:
    """Main service for secure data wiping operations"""
    
    def __init__(self):
        self.system = platform.system().lower()
        self.is_windows = self.system == "windows"
        self.is_linux = self.system == "linux"
        self.is_macos = self.system == "darwin"
        self._wipe_methods = WipeMethods(self.system)
        
    def detect_device_type(self, device_path: str) -> str:
        """Detect device type (HDD, SSD, NVMe, USB)"""
        try:
            if self.is_linux:
                return self._detect_linux_device_type(device_path)
            elif self.is_windows:
                return self._detect_windows_device_type(device_path)
            elif self.is_macos:
                return self._detect_macos_device_type(device_path)
        except Exception as e:
            logger.error(f"Failed to detect device type: {e}")
        return "unknown"
    
    def _detect_linux_device_type(self, device_path: str) -> str:
        """Detect device type on Linux"""
        try:
            if "nvme" in device_path:
                return "nvme"
            
            result = subprocess.run(
                ["lsblk", "-d", "-o", "NAME,ROTA", device_path],
                capture_output=True, text=True, check=True,
                timeout=PROBE_TIMEOUT_SECONDS
            )
            if result.returncode == 0:
                lines = result.stdout.strip().split('\n')
                if len(lines) > 1:
                    rota = lines[1].split()[-1]
                    return "ssd" if rota == "0" else "hdd"
            
            return "unknown"
        except Exception as e:
            logger.error(f"Linux device type detection failed: {e}")
            return "unknown"
    
    def _detect_windows_device_type(self, device_path: str) -> str:
        """Detect device type on Windows"""
        try:
            # \\.\PhysicalDrive0 exposes DeviceID '0'; matching the whole
            # leaf name ("PhysicalDrive0") never did, so disks came back "unknown".
            import re
            _m = re.search(r"PhysicalDrive(\d+)", device_path, re.IGNORECASE)
            device_id = _m.group(1) if _m else device_path.split('\\')[-1]
            cmd = f"""
            Get-PhysicalDisk | Where-Object {{ $_.DeviceID -eq '{device_id}' }} | 
            Select-Object MediaType, BusType
            """
            result = subprocess.run(
                ["powershell", "-Command", cmd],
                capture_output=True, text=True, check=True,
                timeout=PROBE_TIMEOUT_SECONDS
            )
            
            if "SSD" in result.stdout:
                return "ssd"
            elif "HDD" in result.stdout:
                return "hdd"
            elif "NVMe" in result.stdout:
                return "nvme"
            else:
                return "unknown"
        except Exception as e:
            logger.error(f"Windows device type detection failed: {e}")
            return "unknown"
    
    def _detect_macos_device_type(self, device_path: str) -> str:
        """Detect device type on macOS"""
        try:
            result = subprocess.run(
                ["system_profiler", "SPStorageDataType"],
                capture_output=True, text=True, check=True,
                timeout=PROBE_TIMEOUT_SECONDS
            )
            
            if "Solid State" in result.stdout:
                return "ssd"
            elif "Rotational" in result.stdout:
                return "hdd"
            else:
                return "unknown"
        except Exception as e:
            logger.error(f"macOS device type detection failed: {e}")
            return "unknown"
    
    def get_device_info(self, device_path: str) -> Dict[str, Any]:
        """Get comprehensive device information"""
        info = {
            "path": device_path,
            "type": self.detect_device_type(device_path),
            "size": self._get_device_size(device_path),
            "model": self._get_device_model(device_path),
            "serial": self._get_device_serial(device_path),
            "is_removable": self._is_removable_device(device_path)
        }
        return info
    
    def _get_device_size(self, device_path: str) -> Optional[int]:
        """Get device size in bytes"""
        try:
            if self.is_linux:
                result = subprocess.run(
                    ["blockdev", "--getsize64", device_path],
                    capture_output=True, text=True, check=True,
                    timeout=PROBE_TIMEOUT_SECONDS
                )
                return int(result.stdout.strip())
            elif self.is_windows:
                # Windows implementation
                pass
        except Exception as e:
            logger.error(f"Failed to get device size: {e}")
        return None
    
    def _get_device_model(self, device_path: str) -> Optional[str]:
        """Get device model"""
        try:
            if self.is_linux:
                result = subprocess.run(
                    ["lsblk", "-d", "-o", "MODEL", device_path],
                    capture_output=True, text=True, check=True,
                    timeout=PROBE_TIMEOUT_SECONDS
                )
                lines = result.stdout.strip().split('\n')
                if len(lines) > 1:
                    return lines[1].strip()
        except Exception as e:
            logger.error(f"Failed to get device model: {e}")
        return None
    
    def _get_device_serial(self, device_path: str) -> Optional[str]:
        """Get device serial number"""
        try:
            if self.is_linux:
                result = subprocess.run(
                    ["lsblk", "-d", "-o", "SERIAL", device_path],
                    capture_output=True, text=True, check=True,
                    timeout=PROBE_TIMEOUT_SECONDS
                )
                lines = result.stdout.strip().split('\n')
                if len(lines) > 1:
                    return lines[1].strip()
        except Exception as e:
            logger.error(f"Failed to get device serial: {e}")
        return None
    
    def _is_removable_device(self, device_path: str) -> bool:
        """Check if device is removable"""
        try:
            if self.is_linux:
                result = subprocess.run(
                    ["lsblk", "-d", "-o", "RM", device_path],
                    capture_output=True, text=True, check=True,
                    timeout=PROBE_TIMEOUT_SECONDS
                )
                lines = result.stdout.strip().split('\n')
                if len(lines) > 1:
                    return lines[1].strip() == "1"
        except Exception as e:
            logger.error(f"Failed to check if device is removable: {e}")
        return False
    
    def wipe_device(self, device_path: str, method: WipeMethod, 
                   passes: int = 1, progress_callback: Optional[Callable] = None) -> Dict[str, Any]:
        """Main method to wipe a device using specified method"""
        
        if not os.path.exists(device_path):
            raise FileNotFoundError(f"Device {device_path} not found")
        
        device_type = self.detect_device_type(device_path)
        logger.info(f"Starting wipe of {device_path} using {method.value} method")
        
        # Get initial hash
        sha_before = self._get_device_hash(device_path)
        
        start_time = time.time()
        
        try:
            if method == WipeMethod.CRYPTO_ERASE:
                result = self._wipe_methods.crypto_erase(device_path, device_type, progress_callback)
            elif method == WipeMethod.ATA_SANITIZE:
                result = self._wipe_methods._ata_sanitize(device_path, progress_callback)
            elif method == WipeMethod.NVME_FORMAT:
                result = self._wipe_methods._nvme_format(device_path, progress_callback)
            elif method == WipeMethod.NIST_800_88:
                result = self._wipe_methods.nist_800_88_wipe(device_path, passes, progress_callback)
            elif method == WipeMethod.DOD_5220_22_M:
                result = self._wipe_methods.dod_5220_22_m_wipe(device_path, passes, progress_callback)
            elif method == WipeMethod.GUTMANN:
                result = self._wipe_methods.gutmann_wipe(device_path, progress_callback)
            elif method == WipeMethod.SINGLE_PASS:
                result = self._wipe_methods.single_pass_wipe(device_path, progress_callback)
            elif method == WipeMethod.THREE_PASS:
                result = self._wipe_methods.three_pass_wipe(device_path, progress_callback)
            else:
                raise ValueError(f"Unsupported wipe method: {method}")
            
            end_time = time.time()
            sha_after = self._get_device_hash(device_path)
            
            return {
                "success": True,
                "method": method.value,
                "device_path": device_path,
                "device_type": device_type,
                "passes": passes,
                "duration": end_time - start_time,
                "sha_before": sha_before,
                "sha_after": sha_after,
                "result": result
            }
            
        except Exception as e:
            end_time = time.time()
            logger.error(f"Wipe failed: {e}")
            failure = {
                "success": False,
                "method": method.value,
                "device_path": device_path,
                "device_type": device_type,
                "passes": passes,
                "duration": end_time - start_time,
                "sha_before": sha_before,
                "sha_after": None,
                "error": str(e),
            }
            # Carry the structured cause through so the UI can describe what
            # actually failed instead of assuming a missing Administrator token.
            failure.update(classify_wipe_exception(e))
            return failure
    
    def _get_device_hash(self, device_path: str, size: int = 1024 * 1024) -> Optional[str]:
        """Get SHA-256 hash of device (first 1MB)"""
        try:
            hash_obj = hashlib.sha256()
            with open(device_path, "rb") as f:
                data = f.read(size)
                hash_obj.update(data)
            return hash_obj.hexdigest()
        except Exception as e:
            logger.error(f"Failed to get device hash: {e}")
            return None

# Global instance
secure_wipe_service = SecureWipeService()