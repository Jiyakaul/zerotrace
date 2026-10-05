"""
Implementation of specific wipe methods for secure data erasure
"""

import os
import time
import subprocess
import secrets
import tempfile
from typing import Optional, Callable, Dict, Any, Tuple
import logging

logger = logging.getLogger(__name__)


class WipeOperationError(Exception):
    """A wipe step failed, carrying what failed and why.

    The category lets the UI show the actual problem (write failed, volume
    locked, device disconnected, ...) instead of assuming every failure is a
    missing Administrator token.
    """

    def __init__(self, message: str, *, category: str = "wipe_failed",
                 operation: str = "", win32_error=None, offset=None, detail=None):
        self.category = category
        self.operation = operation
        self.win32_error = win32_error
        self.offset = offset
        self.detail = detail
        super().__init__(message)

    def as_dict(self) -> Dict[str, Any]:
        return {
            "error": str(self),
            "error_category": self.category,
            "error_operation": self.operation,
            "win32_error": self.win32_error,
            "error_offset": self.offset,
            "error_detail": self.detail,
        }


class WipeMethods:
    """Implementation of various wipe methods"""
    
    def __init__(self, system: str):
        self.system = system
        self.is_windows = system == "windows"
        self.is_linux = system == "linux"
        self.is_macos = system == "darwin"
        # Verification performed while the device was still locked by the
        # overwrite. Preferred over re-opening the device afterwards - see
        # _verify_zeroed().
        self._inline_verification: Optional[Dict[str, Any]] = None
    
    def crypto_erase(self, device_path: str, device_type: str, 
                    progress_callback: Optional[Callable] = None) -> Dict[str, Any]:
        """Perform cryptographic erasure (preferred for SSDs)"""
        logger.info("Performing cryptographic erasure")
        
        if progress_callback:
            progress_callback(0, "Initializing cryptographic erasure...")
        
        try:
            if device_type == "nvme":
                return self._nvme_crypto_erase(device_path, progress_callback)
            elif device_type in ["ssd", "hdd"]:
                return self._ata_crypto_erase(device_path, progress_callback)
            else:
                # Fallback to secure overwrite
                return self._secure_overwrite(device_path, 1, progress_callback)
        except Exception as e:
            logger.error(f"Crypto erase failed: {e}")
            raise
    
    def _nvme_crypto_erase(self, device_path: str, progress_callback: Optional[Callable] = None) -> Dict[str, Any]:
        """NVMe cryptographic erase using format command"""
        try:
            if progress_callback:
                progress_callback(10, "Formatting NVMe device with crypto erase...")
            
            # Use nvme format command with crypto erase
            result = subprocess.run(
                ["nvme", "format", device_path, "--ses=1", "--pi=0"],
                capture_output=True, text=True, check=True
            )
            
            if progress_callback:
                progress_callback(100, "NVMe crypto erase completed")
            
            return {"method": "nvme_crypto_erase", "success": True}
        except subprocess.CalledProcessError as e:
            raise Exception(f"NVMe crypto erase failed: {e.stderr}")
    
    def _ata_crypto_erase(self, device_path: str, progress_callback: Optional[Callable] = None) -> Dict[str, Any]:
        """ATA cryptographic erase using hdparm"""
        try:
            if progress_callback:
                progress_callback(10, "Setting ATA security password...")
            
            # Set security password
            password = secrets.token_hex(16)
            subprocess.run(
                ["hdparm", "--user-master", "u", "--security-set-pass", password, device_path],
                check=True
            )
            
            if progress_callback:
                progress_callback(50, "Performing ATA crypto erase...")
            
            # Perform crypto erase
            subprocess.run(
                ["hdparm", "--security-erase", password, device_path],
                check=True
            )
            
            if progress_callback:
                progress_callback(100, "ATA crypto erase completed")
            
            return {"method": "ata_crypto_erase", "success": True}
        except subprocess.CalledProcessError as e:
            raise Exception(f"ATA crypto erase failed: {e.stderr}")
    
    def nist_800_88_wipe(self, device_path: str, passes: int, 
                        progress_callback: Optional[Callable] = None) -> Dict[str, Any]:
        """NIST 800-88 compliant wipe"""
        logger.info("Performing NIST 800-88 compliant wipe")
        
        # NIST 800-88 recommends:
        # 1. Clear (overwrite with zeros)
        # 2. Verify the clear
        # 3. Purge (crypto erase if available, otherwise additional overwrite)
        
        if progress_callback:
            progress_callback(0, "Starting NIST 800-88 wipe...")
        
        # Step 1: Clear
        if progress_callback:
            progress_callback(10, "Clearing device (overwrite with zeros)...")
        
        self._secure_overwrite(device_path, 1, progress_callback, offset=10, max_progress=60)
        
        # Step 2: Verify
        if progress_callback:
            progress_callback(70, "Verifying clear operation...")
        
        # Verify by reading the device back. Never softened: a failure here
        # still aborts the wipe, but it now reports what was actually found.
        verification = self._verify_zeroed(device_path)
        if not verification["ok"]:
            raise WipeOperationError(
                f"Clear verification failed - {verification['summary']}",
                category="verification_failed", operation="read-back verification",
                detail=verification.get("regions"),
            )
        
        # Step 3: Purge (prefer sanitize/crypto erase on SSD/NVMe; fallback overwrite; try discard)
        if progress_callback:
            progress_callback(80, "Purging device...")
        
        try:
            # Detect device type best-effort
            device_type = self._detect_device_type_best_effort(device_path)
            # Try crypto/sanitize erase first
            self.crypto_erase(device_path, device_type, None)
            if progress_callback:
                progress_callback(100, "NIST 800-88 wipe completed (crypto erase)")
        except:
            # Fallback to additional overwrite
            self._secure_overwrite(device_path, 1, progress_callback, offset=80, max_progress=95)
            # Best-effort discard/TRIM for SSDs
            try:
                if device_type in ("ssd", "nvme"):
                    if progress_callback:
                        progress_callback(96, "Attempting discard/TRIM...")
                    self._try_discard(device_path)
            except Exception:
                pass
            if progress_callback:
                progress_callback(100, "NIST 800-88 wipe completed (overwrite)")
        
        return {"method": "nist_800_88", "success": True}

    def _detect_device_type_best_effort(self, device_path: str) -> str:
        """Lightweight device type detection without cross-service dependency."""
        try:
            if self.is_linux:
                if "nvme" in device_path:
                    return "nvme"
                out = subprocess.run(["lsblk", "-d", "-o", "ROTA", device_path], capture_output=True, text=True)
                if out.returncode == 0:
                    lines = (out.stdout or "").strip().splitlines()
                    if lines:
                        rota = lines[-1].strip()
                        return "ssd" if rota == "0" else "hdd"
            elif self.is_macos:
                if "nvme" in device_path.lower():
                    return "nvme"
                info = subprocess.run(["diskutil", "info", device_path], capture_output=True, text=True)
                if info.returncode == 0 and "Solid State" in (info.stdout or ""):
                    return "ssd"
            elif self.is_windows:
                if "physicaldrive" in device_path.lower():
                    # Unable to reliably detect here; assume ssd unknown
                    return "unknown"
        except Exception:
            pass
        return "unknown"

    def _try_discard(self, device_path: str) -> None:
        """Best-effort discard/trim to inform SSD/NVMe the blocks are unused."""
        try:
            if self.is_linux:
                # blkdiscard may require exclusive access
                subprocess.run(["blkdiscard", "-f", device_path], check=False)
            elif self.is_macos:
                # macOS performs TRIM internally on erase; no direct tool commonly available
                pass
            elif self.is_windows:
                # Windows TRIM is FS-level; for raw device there is no simple direct call here
                pass
        except Exception:
            # best-effort only
            pass
    
    def dod_5220_22_m_wipe(self, device_path: str, passes: int, 
                          progress_callback: Optional[Callable] = None) -> Dict[str, Any]:
        """DoD 5220.22-M compliant wipe"""
        logger.info("Performing DoD 5220.22-M compliant wipe")
        
        # DoD 5220.22-M requires 3 passes:
        # Pass 1: Write all 0s
        # Pass 2: Write all 1s  
        # Pass 3: Write random data
        
        patterns = [
            (b'\x00', "Writing zeros (Pass 1/3)..."),
            (b'\xFF', "Writing ones (Pass 2/3)..."),
            (None, "Writing random data (Pass 3/3)...")
        ]
        
        for i, (pattern, message) in enumerate(patterns):
            if progress_callback:
                progress_callback(i * 33, message)
            
            self._write_pattern(device_path, pattern, progress_callback, 
                              offset=i * 33, max_progress=(i + 1) * 33)
        
        if progress_callback:
            progress_callback(100, "DoD 5220.22-M wipe completed")
        
        return {"method": "dod_5220_22_m", "success": True}
    
    def gutmann_wipe(self, device_path: str, progress_callback: Optional[Callable] = None) -> Dict[str, Any]:
        """Gutmann 35-pass wipe"""
        logger.info("Performing Gutmann 35-pass wipe")
        
        # Gutmann patterns for maximum security
        patterns = [
            b'\x55', b'\xAA', b'\x92\x49\x24', b'\x49\x24\x92',
            b'\x24\x92\x49', b'\x00', b'\x11', b'\x22', b'\x33',
            b'\x44', b'\x55', b'\x66', b'\x77', b'\x88', b'\x99',
            b'\xAA', b'\xBB', b'\xCC', b'\xDD', b'\xEE', b'\xFF',
            b'\x92\x49\x24\x49', b'\x49\x24\x92\x24', b'\x24\x92\x49\x92',
            b'\x6D\xB6\xDB\x6D', b'\xB6\xDB\x6D\xB6', b'\xDB\x6D\xB6\xDB',
            b'\x00', b'\x11', b'\x22', b'\x33', b'\x44', b'\x55',
            b'\x66', b'\x77', b'\x88', b'\x99', b'\xAA', b'\xBB',
            b'\xCC', b'\xDD', b'\xEE', b'\xFF'
        ]
        
        for i, pattern in enumerate(patterns):
            if progress_callback:
                progress_callback(i * 100 // len(patterns), f"Gutmann pass {i+1}/{len(patterns)}...")
            
            self._write_pattern(device_path, pattern, None, 
                              offset=i * 100 // len(patterns), 
                              max_progress=(i + 1) * 100 // len(patterns))
        
        if progress_callback:
            progress_callback(100, "Gutmann wipe completed")
        
        return {"method": "gutmann", "success": True}
    
    def single_pass_wipe(self, device_path: str, progress_callback: Optional[Callable] = None) -> Dict[str, Any]:
        """Single pass wipe with zeros"""
        logger.info("Performing single pass wipe")
        
        if progress_callback:
            progress_callback(0, "Single pass wipe with zeros...")
        
        self._secure_overwrite(device_path, 1, progress_callback)
        
        if progress_callback:
            progress_callback(100, "Single pass wipe completed")
        
        return {"method": "single_pass", "success": True}
    
    def three_pass_wipe(self, device_path: str, progress_callback: Optional[Callable] = None) -> Dict[str, Any]:
        """Three pass wipe (zeros, ones, random)"""
        logger.info("Performing three pass wipe")
        
        patterns = [
            (b'\x00', "Pass 1/3: Writing zeros..."),
            (b'\xFF', "Pass 2/3: Writing ones..."),
            (None, "Pass 3/3: Writing random data...")
        ]
        
        for i, (pattern, message) in enumerate(patterns):
            if progress_callback:
                progress_callback(i * 33, message)
            
            self._write_pattern(device_path, pattern, progress_callback,
                              offset=i * 33, max_progress=(i + 1) * 33)
        
        if progress_callback:
            progress_callback(100, "Three pass wipe completed")
        
        return {"method": "three_pass", "success": True}

    def wipe_file_clear(self, file_path: str, passes: int = 1,
                        progress_callback: Optional[Callable] = None) -> Dict[str, Any]:
        """Securely overwrite a file and delete it (NIST Clear)."""
        try:
            file_size = os.path.getsize(file_path)
            chunk_size = 1024 * 1024

            def _write_pattern_stream(byte_source: Optional[bytes], message: str, offset_pct: int, max_pct: int):
                processed = 0
                if progress_callback:
                    progress_callback(offset_pct, message)
                with open(file_path, 'r+b') as f:
                    while processed < file_size:
                        to_write = min(chunk_size, file_size - processed)
                        if byte_source is None:
                            data = os.urandom(to_write)
                        else:
                            if len(byte_source) == 1:
                                data = byte_source * to_write
                            else:
                                repeats = to_write // len(byte_source) + 1
                                data = (byte_source * repeats)[:to_write]
                        f.write(data)
                        f.flush()
                        os.fsync(f.fileno())
                        processed += to_write
                        if progress_callback and file_size > 0:
                            pct = offset_pct + int((processed / file_size) * (max_pct - offset_pct))
                            progress_callback(min(pct, max_pct), message)

            # Passes: zeros, ones, random (based on requested passes)
            patterns = []
            if passes >= 1:
                patterns.append((b'\x00', "Writing zeros...", 0, 60 if passes == 1 else 33))
            if passes >= 2:
                patterns.append((b'\xFF', "Writing ones...", 33, 66))
            if passes >= 3:
                patterns.append((None, "Writing random data...", 66, 99))

            if not patterns:
                patterns = [(b'\x00', "Writing zeros...", 0, 99)]

            for byte_source, message, start_pct, end_pct in patterns:
                _write_pattern_stream(byte_source, message, start_pct, end_pct)

            # Truncate and delete
            if progress_callback:
                progress_callback(99, "Truncating and deleting file...")
            with open(file_path, 'r+b') as f:
                f.truncate(0)
                f.flush()
                os.fsync(f.fileno())
            os.remove(file_path)

            if progress_callback:
                progress_callback(100, "File wipe completed")
            return {"method": "file_clear", "success": True}
        except Exception as e:
            logger.error(f"File wipe failed: {e}")
            raise
    
    def _secure_overwrite(self, device_path: str, passes: int, 
                         progress_callback: Optional[Callable] = None,
                         offset: int = 0, max_progress: int = 100) -> None:
        """Secure overwrite by streaming zeros across the entire target."""
        try:
            import ctypes, re
            chunk_size = 16 * 1024 * 1024
            zero_chunk = b"\x00" * chunk_size
            for pass_num in range(passes):
                if progress_callback:
                    progress_callback(
                        offset + (pass_num * (max_progress - offset) // passes),
                        f"Overwrite pass {pass_num + 1}/{passes}..."
                    )
                if self.is_windows:
                    lower_path = device_path.lower()
                    is_physical = 'physicaldrive' in lower_path
                    try:
                        is_admin = bool(ctypes.windll.shell32.IsUserAnAdmin())  # type: ignore
                    except Exception:
                        is_admin = False
                    if not is_admin:
                        raise WipeOperationError(
                            "Administrator privileges are required on Windows.",
                            category="admin_required", operation="privilege check",
                        )
                    if is_physical:
                        m = re.search(r"PhysicalDrive(\d+)", device_path, re.IGNORECASE)
                        if not m:
                            raise WipeOperationError(
                                f"Could not parse a PhysicalDrive number from {device_path!r}.",
                                category="invalid_target", operation="device path parse",
                            )
                        disk_number = int(m.group(1))
                        self._windows_raw_overwrite(
                            device_path, disk_number, progress_callback,
                            offset=offset, max_progress=max_progress,
                            pass_index=pass_num, pass_count=passes,
                        )
                    else:
                        # Reject drive-letter/volume path to avoid partial clearing
                        raise Exception("On Windows, provide \\ \\.\\PhysicalDriveN for full-device secure wipe.")
                else:
                    # POSIX: stream zeros until EOF
                    with open(device_path, 'wb', buffering=0) as f:
                        while True:
                            try:
                                written = f.write(zero_chunk)
                                if not written:
                                    break
                                f.flush()
                                os.fsync(f.fileno())
                            except OSError:
                                break
        except subprocess.CalledProcessError as e:
            raise Exception(f"Secure overwrite failed: {e}")
    
    def _windows_raw_overwrite(self, device_path: str, disk_number: int,
                               progress_callback: Optional[Callable] = None,
                               offset: int = 0, max_progress: int = 100,
                               pass_index: int = 0, pass_count: int = 1) -> None:
        """Zero a Windows physical disk in-process, then verify while still locked.

        Replaces `diskpart clean all`. The disk is held open and its volumes
        locked for the whole write *and* the read-back, which closes the window
        in which Windows would otherwise re-initialise the freshly-RAW disk and
        write a new MBR to sector 0 before verification could run.
        """
        from services.win_raw_disk import WindowsRawDisk, RawDiskError

        try:
            with WindowsRawDisk(device_path, disk_number) as disk:
                logger.info(
                    "OVERWRITE: %s - %s bytes, pass %d/%d (in-process raw write, "
                    "cache bypassed)",
                    device_path, f"{disk.size:,}", pass_index + 1, pass_count,
                )
                disk.delete_drive_layout()

                started = time.time()

                def on_progress(done: int, total: int) -> None:
                    pct = (done / total) if total else 0
                    elapsed = time.time() - started
                    rate = done / elapsed if elapsed > 0 else 0
                    eta = ((total - done) / rate) if rate > 0 else 0
                    logger.info(
                        "OVERWRITE: %5.1f%%  %s / %s bytes  %.1f MB/s  eta %s",
                        pct * 100, f"{done:,}", f"{total:,}",
                        rate / (1024 * 1024), self._format_eta(eta),
                    )
                    if progress_callback:
                        span = max_progress - offset
                        # Share the band across passes so multi-pass methods
                        # still report a monotonic percentage.
                        base = offset + (span * pass_index // max(1, pass_count))
                        width = span // max(1, pass_count)
                        progress_callback(
                            int(base + width * pct),
                            f"Overwriting {device_path} - {pct * 100:.1f}% "
                            f"({rate / (1024 * 1024):.0f} MB/s)",
                        )

                written = disk.write_pattern(progress_cb=on_progress)
                elapsed = time.time() - started
                logger.info(
                    "OVERWRITE: wrote %s bytes in %.0fs (%.1f MB/s), buffers flushed",
                    f"{written:,}", elapsed,
                    (written / elapsed / (1024 * 1024)) if elapsed else 0,
                )

                if written < disk.size:
                    raise WipeOperationError(
                        f"Overwrite covered only {written:,} of {disk.size:,} bytes",
                        category="write_failed", operation="write_pattern",
                        offset=written,
                    )

                # Verify now, before the disk is released back to Windows.
                inline = self._verify_via_handle(disk, device_path)
                self._inline_verification = {
                    "device": device_path,
                    "at": time.time(),
                    "result": inline,
                }
                if not inline["ok"]:
                    raise WipeOperationError(
                        f"Post-write verification failed - {inline['summary']}",
                        category="verification_failed",
                        operation="read-back verification (locked handle)",
                        detail=inline.get("regions"),
                    )

        except RawDiskError as e:
            # Surfaces the precise Win32 failure and byte offset instead of the
            # silent success diskpart used to report. The category travels with
            # the exception so the UI can describe the real problem rather than
            # defaulting to "you need Administrator".
            wrapped = WipeOperationError(
                f"Raw overwrite of {device_path} failed - {e}",
                category=e.category, operation=e.operation,
                win32_error=e.code, offset=e.offset,
            )
            raise wrapped from e

    @staticmethod
    def _format_eta(seconds: float) -> str:
        seconds = int(max(0, seconds))
        h, m, s = seconds // 3600, (seconds % 3600) // 60, seconds % 60
        if h:
            return f"{h}h{m:02d}m"
        if m:
            return f"{m}m{s:02d}s"
        return f"{s}s"

    def _verify_via_handle(self, disk, device_path: str) -> Dict[str, Any]:
        """Read-back verification through the still-open, locked disk handle."""
        sample_size = 1024 * 1024
        size = disk.size
        align = self._SECTOR_ALIGN

        if size > sample_size * 3:
            regions = [
                ("head", 0),
                ("middle", ((size // 2) // align) * align),
                ("tail", ((size - sample_size) // align) * align),
            ]
        else:
            regions = [("head", 0)]

        logger.info(
            "VERIFY: target=%s size=%s bytes (locked handle, cache bypassed) "
            "sample=%d bytes/region expected=0x00",
            device_path, f"{size:,}", sample_size,
        )

        results = []
        for name, off in regions:
            entry = {"name": name, "offset": off, "requested": sample_size, "read": 0,
                     "status": "ok", "nonzero": 0, "first_offset": -1,
                     "first_value": 0, "context": "", "error": None}
            try:
                data = disk.read(off, sample_size)
            except Exception as e:
                entry.update(status="error", error=f"{type(e).__name__}: {e}")
                logger.error("VERIFY: %-6s offset=%-14d READ FAILED: %s",
                             name, off, entry["error"])
                results.append(entry)
                continue

            entry["read"] = len(data)
            nonzero = len(data) - data.count(0)
            if nonzero:
                first = next(i for i, b in enumerate(data) if b)
                lo, hi = max(0, first - 8), min(len(data), first + 24)
                entry.update(
                    status="mismatch", nonzero=nonzero, first_offset=off + first,
                    first_value=data[first], context=data[lo:hi].hex(" "),
                )
                logger.error(
                    "VERIFY: %-6s offset=%-14d NOT ZERO - read=%d bytes, %d non-zero, "
                    "first at byte %d = 0x%02X, context=[%s]",
                    name, off, entry["read"], nonzero, entry["first_offset"],
                    entry["first_value"], entry["context"],
                )
            else:
                logger.info("VERIFY: %-6s offset=%-14d OK - %d bytes, all zero",
                            name, off, entry["read"])
            results.append(entry)

        errors = [r for r in results if r["status"] == "error"]
        mismatches = [r for r in results if r["status"] == "mismatch"]
        if errors:
            summary = (f"could not read the device back ({errors[0]['name']} region at "
                       f"offset {errors[0]['offset']}: {errors[0]['error']})")
        elif mismatches:
            m = mismatches[0]
            summary = (f"device still contains data - {m['nonzero']:,} non-zero bytes in the "
                       f"{m['name']} region, first at byte {m['first_offset']} "
                       f"(0x{m['first_value']:02X}). The overwrite did not take effect.")
        else:
            summary = (f"{len(results)} region(s) sampled through the locked handle, all zero "
                       f"({sample_size * len(results):,} bytes read)")

        ok = not errors and not mismatches
        logger.info("VERIFY: result=%s - %s", "PASS" if ok else "FAIL", summary)
        return {"ok": ok, "summary": summary, "regions": results,
                "device": device_path, "size": size,
                "size_source": "locked handle (IOCTL_DISK_GET_LENGTH_INFO)"}

    # NOTE: the previous `diskpart clean all` delegation was removed. It exited 0
    # on failure (real errors went only to the VDS event log), gave no progress
    # for the ~17 minutes a full-device zero takes, and released the disk to
    # Windows before verification could read it back. _windows_raw_overwrite()
    # above does the write in-process instead. There is deliberately no fallback
    # to diskpart: silently retrying with a mechanism known to misreport success
    # is exactly the failure mode this replaced.

    def _write_pattern(self, device_path: str, pattern: Optional[bytes],
                      progress_callback: Optional[Callable] = None,
                      offset: int = 0, max_progress: int = 100) -> None:
        """Write a specific pattern to device"""
        try:
            if pattern is None:
                # Random data
                self._write_random_data(device_path, progress_callback, offset, max_progress)
            else:
                # Specific pattern
                self._write_specific_pattern(device_path, pattern, progress_callback, offset, max_progress)
        except Exception as e:
            raise Exception(f"Pattern write failed: {e}")
    
    def _write_random_data(self, device_path: str, progress_callback: Optional[Callable] = None,
                          offset: int = 0, max_progress: int = 100) -> None:
        """Write random data across the entire target by streaming chunks."""
        try:
            chunk_size = 16 * 1024 * 1024
            if self.is_windows:
                device_path_escaped = device_path.replace('\\', '\\\\')
                cmd = (
                    "$fs = [System.IO.File]::Open('{path}', [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite)\n"
                    "$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()\n"
                    "$buffer = New-Object byte[] {size}\n"
                    "while ($true) {{\n"
                    "  $rng.GetBytes($buffer)\n"
                    "  try {{ $fs.Write($buffer, 0, $buffer.Length) }} catch {{ break }}\n"
                    "  $fs.Flush(); $fs.Flush(true)\n"
                    "}}\n"
                    "$fs.Close()\n"
                ).format(path=device_path_escaped, size=chunk_size)
                subprocess.run(["powershell", "-NoProfile", "-Command", cmd], check=True)
            else:
                with open(device_path, 'wb', buffering=0) as f:
                    while True:
                        data = os.urandom(chunk_size)
                        try:
                            written = f.write(data)
                            if not written:
                                break
                            f.flush()
                            os.fsync(f.fileno())
                        except OSError:
                            break
        except subprocess.CalledProcessError as e:
            raise Exception(f"Random data write failed: {e}")
    
    def _write_specific_pattern(self, device_path: str, pattern: bytes,
                               progress_callback: Optional[Callable] = None,
                               offset: int = 0, max_progress: int = 100) -> None:
        """Write specific pattern across the entire target by streaming repeated buffers."""
        try:
            chunk_size = 16 * 1024 * 1024
            if len(pattern) == 0:
                raise Exception("Pattern must be non-empty")
            repeats = (chunk_size // len(pattern)) + 1
            chunk = (pattern * repeats)[:chunk_size]
            if self.is_windows:
                device_path_escaped = device_path.replace('\\', '\\\\')
                pattern_hex = chunk.hex()
                cmd = (
                    "$fs = [System.IO.File]::Open('{path}', [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite)\n"
                    "$buffer = [System.Convert]::FromHexString('{hex}')\n"
                    "while ($true) {{\n"
                    "  try {{ $fs.Write($buffer, 0, $buffer.Length) }} catch {{ break }}\n"
                    "  $fs.Flush(); $fs.Flush(true)\n"
                    "}}\n"
                    "$fs.Close()\n"
                ).format(path=device_path_escaped, hex=pattern_hex)
                subprocess.run(["powershell", "-NoProfile", "-Command", cmd], check=True)
            else:
                with open(device_path, 'wb', buffering=0) as f:
                    while True:
                        try:
                            written = f.write(chunk)
                            if not written:
                                break
                            f.flush()
                            os.fsync(f.fileno())
                        except OSError:
                            break
        except subprocess.CalledProcessError as e:
            raise Exception(f"Pattern write failed: {e}")
    
    # Alignment used for raw-device reads. 4096 is safe for both 512e and 4Kn
    # media; reads that straddle a sector boundary are rejected by the driver.
    _SECTOR_ALIGN = 4096

    def _device_size_bytes(self, device_path: str) -> Tuple[Optional[int], str]:
        """Usable size of the target, plus how it was determined (diagnostics).

        os.path.getsize() reports 0 for a Windows raw device such as
        \\\\.\\PhysicalDrive2, so the previous code always fell back to sampling
        only the first megabyte - the middle and tail were never checked at all.
        Ask the disk driver instead.
        """
        if self.is_windows and "physicaldrive" in device_path.lower():
            try:
                import ctypes
                from ctypes import wintypes

                GENERIC_READ = 0x80000000
                FILE_SHARE_READ = 0x00000001
                FILE_SHARE_WRITE = 0x00000002
                OPEN_EXISTING = 3
                IOCTL_DISK_GET_LENGTH_INFO = 0x0007405C
                INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value

                k32 = ctypes.windll.kernel32
                # restype MUST be HANDLE: the default c_int truncates 64-bit
                # handles and the validity check would then be meaningless.
                k32.CreateFileW.restype = wintypes.HANDLE
                k32.CreateFileW.argtypes = [
                    wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                    wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE,
                ]
                handle = k32.CreateFileW(
                    device_path, GENERIC_READ,
                    FILE_SHARE_READ | FILE_SHARE_WRITE,
                    None, OPEN_EXISTING, 0, None,
                )
                if handle and handle != INVALID_HANDLE_VALUE:
                    try:
                        length = ctypes.c_ulonglong(0)
                        returned = wintypes.DWORD(0)
                        ok = k32.DeviceIoControl(
                            wintypes.HANDLE(handle), IOCTL_DISK_GET_LENGTH_INFO,
                            None, 0, ctypes.byref(length), ctypes.sizeof(length),
                            ctypes.byref(returned), None,
                        )
                        if ok and length.value:
                            return int(length.value), "IOCTL_DISK_GET_LENGTH_INFO"
                        logger.debug("IOCTL_DISK_GET_LENGTH_INFO failed: err=%s",
                                     ctypes.get_last_error())
                    finally:
                        k32.CloseHandle(wintypes.HANDLE(handle))
                else:
                    logger.debug("CreateFileW on %s failed: err=%s",
                                 device_path, ctypes.GetLastError())
            except Exception as e:
                logger.debug("Windows size probe failed: %s", e)

        try:
            size = os.path.getsize(device_path)
            if size > 0:
                return size, "os.path.getsize"
        except Exception:
            pass

        try:
            with open(device_path, "rb") as f:
                f.seek(0, os.SEEK_END)
                size = f.tell()
                if size > 0:
                    return size, "seek-to-end"
        except Exception:
            pass

        return None, "unknown"

    def _verify_region(self, device_path: str, name: str, offset: int,
                       length: int) -> Dict[str, Any]:
        """Read one region back and report exactly what was found there."""
        result = {
            "name": name, "offset": offset, "requested": length, "read": 0,
            "status": "ok", "nonzero": 0, "first_offset": -1,
            "first_value": 0, "context": "", "error": None,
        }
        try:
            # buffering=0: let every read go straight to the device instead of
            # through Python's buffer, so sizes/offsets stay sector aligned and
            # nothing is served from a stale user-space buffer.
            with open(device_path, "rb", buffering=0) as f:
                if offset:
                    f.seek(offset)
                data = bytearray()
                while len(data) < length:
                    chunk = f.read(length - len(data))
                    if not chunk:
                        break
                    data.extend(chunk)
        except Exception as e:
            result["status"] = "error"
            result["error"] = f"{type(e).__name__}: {e}"
            return result

        result["read"] = len(data)
        if not data:
            # Previously an empty read was treated as "verified" - a device that
            # could not be read at all counted as proof it was clean.
            result["status"] = "error"
            result["error"] = "read returned no data"
            return result

        nonzero = len(data) - data.count(0)
        if nonzero:
            first = next(i for i, b in enumerate(data) if b)
            lo, hi = max(0, first - 8), min(len(data), first + 24)
            result.update(
                status="mismatch",
                nonzero=nonzero,
                first_offset=offset + first,
                first_value=data[first],
                context=bytes(data[lo:hi]).hex(" "),
            )
        return result

    def _verify_zeroed(self, device_path: str) -> Dict[str, Any]:
        """Read back sampled regions and confirm the device really is zeroed.

        Returns a structured result rather than a bare bool: a read failure and
        genuinely non-zero data are completely different problems, and collapsing
        both into False produced an unexplained "Clear verification failed".
        """
        # Prefer the read-back taken while the device was still locked by the
        # overwrite. Re-opening a Windows physical disk after release is not
        # equivalent: the disk is RAW by then and Windows re-initialises it
        # within moments, writing a fresh MBR to sector 0. That MBR is Windows'
        # own, not residual user data, but a fresh read cannot tell them apart -
        # which is exactly what produced the false "385 non-zero bytes at byte 0
        # (0x33)" failure. This is not a relaxation: the inline check is the
        # stricter one (unbuffered, exclusive) and a failure there still aborts.
        inline = self._inline_verification
        if (
            inline
            and inline.get("device") == device_path
            and (time.time() - inline.get("at", 0)) < 300
        ):
            logger.info(
                "VERIFY: using the read-back taken while %s was still locked "
                "(prevents Windows' post-clean re-initialisation from being "
                "mistaken for residual data)",
                device_path,
            )
            return inline["result"]

        sample_size = 1024 * 1024
        size, size_source = self._device_size_bytes(device_path)

        logger.info(
            "VERIFY: target=%s size=%s bytes (via %s) sample=%d bytes/region expected=0x00",
            device_path,
            f"{size:,}" if size else "unknown",
            size_source,
            sample_size,
        )

        if size and size > sample_size * 3:
            align = self._SECTOR_ALIGN
            regions = [
                ("head", 0),
                ("middle", ((size // 2) // align) * align),
                ("tail", ((size - sample_size) // align) * align),
            ]
        else:
            regions = [("head", 0)]
            logger.warning(
                "VERIFY: only the head region can be sampled (size=%s) - "
                "coverage is reduced", size,
            )

        results = []
        for name, offset in regions:
            r = self._verify_region(device_path, name, offset, sample_size)
            results.append(r)
            if r["status"] == "error":
                logger.error(
                    "VERIFY: %-6s offset=%-14d READ FAILED: %s",
                    name, offset, r["error"],
                )
            elif r["status"] == "mismatch":
                logger.error(
                    "VERIFY: %-6s offset=%-14d NOT ZERO - read=%d bytes, %d non-zero, "
                    "first at byte %d = 0x%02X, context=[%s]",
                    name, offset, r["read"], r["nonzero"],
                    r["first_offset"], r["first_value"], r["context"],
                )
            else:
                logger.info(
                    "VERIFY: %-6s offset=%-14d OK - %d bytes, all zero",
                    name, offset, r["read"],
                )

        errors = [r for r in results if r["status"] == "error"]
        mismatches = [r for r in results if r["status"] == "mismatch"]

        if errors:
            summary = (
                f"could not read the device back ({errors[0]['name']} region at "
                f"offset {errors[0]['offset']}: {errors[0]['error']})"
            )
        elif mismatches:
            m = mismatches[0]
            summary = (
                f"device still contains data - {m['nonzero']:,} non-zero bytes in the "
                f"{m['name']} region, first at byte {m['first_offset']} "
                f"(0x{m['first_value']:02X}). The overwrite did not take effect."
            )
        else:
            summary = (
                f"{len(results)} region(s) sampled, all zero "
                f"({sample_size * len(results):,} bytes read)"
            )

        ok = not errors and not mismatches
        logger.info("VERIFY: result=%s - %s", "PASS" if ok else "FAIL", summary)

        return {
            "ok": ok,
            "summary": summary,
            "regions": results,
            "device": device_path,
            "size": size,
            "size_source": size_source,
        }


    def _ata_sanitize(self, device_path: str, progress_callback: Optional[Callable] = None) -> Dict[str, Any]:
        """ATA sanitize command"""
        try:
            if progress_callback:
                progress_callback(0, "Starting ATA sanitize...")
            
            # Use hdparm for ATA sanitize
            subprocess.run([
                "hdparm", "--sanitize-crypto-scramble", device_path
            ], check=True)
            
            if progress_callback:
                progress_callback(50, "ATA sanitize in progress...")
            
            # Wait for completion
            while True:
                result = subprocess.run([
                    "hdparm", "--sanitize-status", device_path
                ], capture_output=True, text=True, check=True)
                
                if "Sanitize complete" in result.stdout:
                    break
                elif "Sanitize failed" in result.stdout:
                    raise Exception("ATA sanitize failed")
                
                time.sleep(1)
            
            if progress_callback:
                progress_callback(100, "ATA sanitize completed")
            
            return {"method": "ata_sanitize", "success": True}
        except subprocess.CalledProcessError as e:
            raise Exception(f"ATA sanitize failed: {e}")
    
    def _nvme_format(self, device_path: str, progress_callback: Optional[Callable] = None) -> Dict[str, Any]:
        """NVMe format command"""
        try:
            if progress_callback:
                progress_callback(0, "Starting NVMe format...")
            
            subprocess.run([
                "nvme", "format", device_path, "--ses=1"
            ], check=True)
            
            if progress_callback:
                progress_callback(100, "NVMe format completed")
            
            return {"method": "nvme_format", "success": True}
        except subprocess.CalledProcessError as e:
            raise Exception(f"NVMe format failed: {e}")
