"""Direct, in-process raw writes to a Windows physical disk.

Replaces the previous `diskpart clean all` delegation for the overwrite step.
That delegation exited 0 even when the clean failed (real errors reached only
the VDS event log), gave no progress for the ~17 minutes a full-device zero
takes, and released the disk to Windows before verification could read it back -
so Windows re-initialised the freshly-RAW removable disk and its new MBR in
sector 0 was indistinguishable from residual user data.

Doing the work here gives per-operation error reporting, real progress, and -
critically - keeps the device open and its volumes locked from the first write
until after verification.

ctypes contract
---------------
Every kernel32 entry point used here declares explicit `argtypes`/`restype`.
That is not cosmetic. Without them ctypes converts Python ints as a 32-bit C
`int`, so a 64-bit VirtualAlloc buffer pointer or a 58 GB file offset raises
"argument N: OverflowError: int too long to convert" before the syscall is even
made. HANDLEs are pointer-sized (c_void_p), byte counts are DWORD, and file
offsets/device sizes are LARGE_INTEGER/ULONGLONG - never c_int.
"""

import ctypes
import logging
from ctypes import wintypes
from typing import Callable, List, Optional

logger = logging.getLogger(__name__)

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

# --------------------------------------------------------------------------
# Win32 constants
# --------------------------------------------------------------------------

GENERIC_READ = 0x80000000
GENERIC_WRITE = 0x40000000
FILE_SHARE_READ = 0x00000001
FILE_SHARE_WRITE = 0x00000002
OPEN_EXISTING = 3
FILE_FLAG_NO_BUFFERING = 0x20000000
FILE_FLAG_WRITE_THROUGH = 0x80000000
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value

FSCTL_LOCK_VOLUME = 0x00090018
FSCTL_UNLOCK_VOLUME = 0x0009001C
FSCTL_DISMOUNT_VOLUME = 0x00090020
IOCTL_DISK_GET_LENGTH_INFO = 0x0007405C
IOCTL_DISK_DELETE_DRIVE_LAYOUT = 0x0007C100
IOCTL_DISK_UPDATE_PROPERTIES = 0x00070140
IOCTL_STORAGE_GET_DEVICE_NUMBER = 0x002D1080
IOCTL_DISK_GET_DRIVE_GEOMETRY_EX = 0x000700A0

MEM_COMMIT = 0x1000
MEM_RESERVE = 0x2000
MEM_RELEASE = 0x8000
PAGE_READWRITE = 0x04

FILE_BEGIN = 0

# Win32 errors meaning the device physically went away mid-operation - exactly
# what a USB stick dropping off the bus during a long write produces.
DEVICE_GONE_ERRORS = {
    21,    # ERROR_NOT_READY
    433,   # ERROR_NO_SUCH_DEVICE
    995,   # ERROR_OPERATION_ABORTED
    1117,  # ERROR_IO_DEVICE
    1167,  # ERROR_DEVICE_NOT_CONNECTED
}

# --------------------------------------------------------------------------
# Error categories surfaced to the API and UI
# --------------------------------------------------------------------------

CAT_DEVICE_OPEN = "device_open_failed"
CAT_VOLUME_LOCK = "volume_lock_failed"
CAT_VOLUME_DISMOUNT = "volume_dismount_failed"
CAT_LAYOUT = "drive_layout_failed"
CAT_WRITE = "write_failed"
CAT_READ = "read_failed"
CAT_SEEK = "seek_failed"
CAT_FLUSH = "flush_failed"
CAT_DISCONNECTED = "device_disconnected"
CAT_QUERY = "device_query_failed"
CAT_INTERNAL = "internal_win32"

# --------------------------------------------------------------------------
# Explicit ctypes signatures. See the module docstring for why these matter.
# --------------------------------------------------------------------------

LPVOID = wintypes.LPVOID           # void*        - pointer sized (8 bytes x64)
LPCVOID = wintypes.LPCVOID         # const void*  - pointer sized
LPDWORD = ctypes.POINTER(wintypes.DWORD)
PLARGE_INTEGER = ctypes.POINTER(wintypes.LARGE_INTEGER)

kernel32.CreateFileW.restype = wintypes.HANDLE
kernel32.CreateFileW.argtypes = [
    wintypes.LPCWSTR,   # lpFileName
    wintypes.DWORD,     # dwDesiredAccess      (GENERIC_WRITE = 0x40000000)
    wintypes.DWORD,     # dwShareMode
    LPVOID,             # lpSecurityAttributes
    wintypes.DWORD,     # dwCreationDisposition
    wintypes.DWORD,     # dwFlagsAndAttributes (0xA0000000 - needs DWORD, not int)
    wintypes.HANDLE,    # hTemplateFile
]

kernel32.CloseHandle.restype = wintypes.BOOL
kernel32.CloseHandle.argtypes = [wintypes.HANDLE]

kernel32.DeviceIoControl.restype = wintypes.BOOL
kernel32.DeviceIoControl.argtypes = [
    wintypes.HANDLE,    # hDevice
    wintypes.DWORD,     # dwIoControlCode
    LPVOID,             # lpInBuffer
    wintypes.DWORD,     # nInBufferSize
    LPVOID,             # lpOutBuffer
    wintypes.DWORD,     # nOutBufferSize
    LPDWORD,            # lpBytesReturned
    LPVOID,             # lpOverlapped
]

kernel32.ReadFile.restype = wintypes.BOOL
kernel32.ReadFile.argtypes = [
    wintypes.HANDLE,    # hFile
    LPVOID,             # lpBuffer          <- 64-bit pointer
    wintypes.DWORD,     # nNumberOfBytesToRead
    LPDWORD,            # lpNumberOfBytesRead
    LPVOID,             # lpOverlapped
]

kernel32.WriteFile.restype = wintypes.BOOL
kernel32.WriteFile.argtypes = [
    wintypes.HANDLE,    # hFile
    LPCVOID,            # lpBuffer          <- argument 2: the OverflowError source
    wintypes.DWORD,     # nNumberOfBytesToWrite
    LPDWORD,            # lpNumberOfBytesWritten
    LPVOID,             # lpOverlapped
]

kernel32.SetFilePointerEx.restype = wintypes.BOOL
kernel32.SetFilePointerEx.argtypes = [
    wintypes.HANDLE,        # hFile
    wintypes.LARGE_INTEGER, # liDistanceToMove  <- 64-bit offset, never c_int
    PLARGE_INTEGER,         # lpNewFilePointer
    wintypes.DWORD,         # dwMoveMethod
]

kernel32.FlushFileBuffers.restype = wintypes.BOOL
kernel32.FlushFileBuffers.argtypes = [wintypes.HANDLE]

kernel32.GetLogicalDrives.restype = wintypes.DWORD
kernel32.GetLogicalDrives.argtypes = []

kernel32.VirtualAlloc.restype = LPVOID
kernel32.VirtualAlloc.argtypes = [LPVOID, ctypes.c_size_t, wintypes.DWORD, wintypes.DWORD]

kernel32.VirtualFree.restype = wintypes.BOOL
kernel32.VirtualFree.argtypes = [LPVOID, ctypes.c_size_t, wintypes.DWORD]


class STORAGE_DEVICE_NUMBER(ctypes.Structure):
    """Output of IOCTL_STORAGE_GET_DEVICE_NUMBER - maps a volume to its disk."""
    _fields_ = [
        ("DeviceType", wintypes.DWORD),
        ("DeviceNumber", wintypes.DWORD),
        ("PartitionNumber", wintypes.DWORD),
    ]


class DISK_GEOMETRY(ctypes.Structure):
    _fields_ = [
        ("Cylinders", wintypes.LARGE_INTEGER),
        ("MediaType", wintypes.DWORD),
        ("TracksPerCylinder", wintypes.DWORD),
        ("SectorsPerTrack", wintypes.DWORD),
        ("BytesPerSector", wintypes.DWORD),
    ]


class DISK_GEOMETRY_EX(ctypes.Structure):
    """Output of IOCTL_DISK_GET_DRIVE_GEOMETRY_EX. DiskSize is a full 64-bit
    value - reading it as a DWORD would silently truncate a >4 GB disk."""
    _fields_ = [
        ("Geometry", DISK_GEOMETRY),
        ("DiskSize", wintypes.LARGE_INTEGER),
        ("Data", ctypes.c_ubyte * 1),
    ]


class RawDiskError(Exception):
    """A raw disk operation failed, with the Win32 error and what was attempted."""

    def __init__(self, message: str, *, category: str = CAT_INTERNAL,
                 operation: str = "", code: Optional[int] = None,
                 offset: Optional[int] = None):
        self.category = category
        self.operation = operation
        self.code = code
        self.offset = offset
        super().__init__(message)

    def as_dict(self) -> dict:
        return {
            "message": str(self),
            "category": self.category,
            "operation": self.operation,
            "win32_error": self.code,
            "offset": self.offset,
        }


def _win_error(prefix: str, *, category: str, operation: str,
               offset: Optional[int] = None) -> RawDiskError:
    """Build a RawDiskError from the live GetLastError() value."""
    code = ctypes.get_last_error()
    try:
        text = ctypes.FormatError(code).strip()
    except Exception:
        text = ""

    if code in DEVICE_GONE_ERRORS:
        category = CAT_DISCONNECTED

    detail = f"{prefix}: Win32 error {code}"
    if text:
        detail += f" ({text})"
    if offset is not None:
        detail += f" at byte offset {offset:,}"
    if category == CAT_DISCONNECTED:
        detail += " - the device disconnected or stopped responding mid-operation"
    return RawDiskError(detail, category=category, operation=operation,
                        code=code, offset=offset)


class _AlignedBuffer:
    """Page-aligned buffer. FILE_FLAG_NO_BUFFERING requires sector alignment,
    and VirtualAlloc always returns page-aligned (4096) zeroed memory."""

    def __init__(self, size: int):
        self.size = size
        ptr = kernel32.VirtualAlloc(None, ctypes.c_size_t(size),
                                    MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE)
        if not ptr:
            raise _win_error("VirtualAlloc failed", category=CAT_INTERNAL,
                             operation="VirtualAlloc")
        # Hold it as c_void_p so it is always passed pointer-sized.
        self.ptr = ctypes.c_void_p(ptr)

    def zero(self) -> None:
        ctypes.memset(self.ptr, 0, self.size)

    def fill(self, pattern: bytes) -> None:
        repeated = (pattern * (self.size // len(pattern) + 1))[:self.size]
        ctypes.memmove(self.ptr, repeated, self.size)

    def as_bytes(self, length: int) -> bytes:
        return ctypes.string_at(self.ptr, length)

    def release(self) -> None:
        if self.ptr:
            kernel32.VirtualFree(self.ptr, ctypes.c_size_t(0), MEM_RELEASE)
            self.ptr = None


def volumes_on_disk(disk_number: int) -> List[str]:
    """Drive letters whose volume lives on the given physical disk."""
    found: List[str] = []
    mask = kernel32.GetLogicalDrives()
    for i in range(26):
        if not (mask >> i) & 1:
            continue
        letter = chr(ord("A") + i)
        raw = kernel32.CreateFileW(
            f"\\\\.\\{letter}:", 0, FILE_SHARE_READ | FILE_SHARE_WRITE,
            None, OPEN_EXISTING, 0, None,
        )
        if not raw or raw == INVALID_HANDLE_VALUE:
            continue
        handle = wintypes.HANDLE(raw)
        try:
            info = STORAGE_DEVICE_NUMBER()
            returned = wintypes.DWORD(0)
            ok = kernel32.DeviceIoControl(
                handle, IOCTL_STORAGE_GET_DEVICE_NUMBER,
                None, 0, ctypes.byref(info), ctypes.sizeof(info),
                ctypes.byref(returned), None,
            )
            if ok and int(info.DeviceNumber) == int(disk_number):
                found.append(letter)
        finally:
            kernel32.CloseHandle(handle)
    return found


class WindowsRawDisk:
    """Exclusive, cache-bypassing access to a physical disk.

    Used as a context manager. Volumes on the disk are locked and dismounted on
    entry and released on exit; the disk handle stays open across the overwrite
    *and* the verification so Windows cannot re-initialise sector 0 in between.
    """

    def __init__(self, device_path: str, disk_number: int):
        self.device_path = device_path
        self.disk_number = int(disk_number)
        self._disk: Optional[wintypes.HANDLE] = None
        self._volume_handles: List[wintypes.HANDLE] = []
        self.size = 0
        self.sector_size = 512
        self.locked_volumes: List[str] = []

    # -- lifecycle ---------------------------------------------------------

    def __enter__(self) -> "WindowsRawDisk":
        try:
            self._lock_volumes()
            self._open_disk()
            self.size = self._query_size()
            self.sector_size = self._query_sector_size()
        except Exception:
            self._cleanup()
            raise
        logger.info(
            "RAWDISK: opened %s exclusively - size=%s bytes, sector=%d, locked volumes=%s",
            self.device_path, f"{self.size:,}", self.sector_size,
            ",".join(self.locked_volumes) or "none",
        )
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        self._cleanup()
        logger.info(
            "RAWDISK: released %s. Windows may now re-initialise the disk and write a "
            "fresh partition table - that happens after sanitisation and verification "
            "are complete and does not affect the result.",
            self.device_path,
        )
        return False

    def _cleanup(self) -> None:
        if self._disk:
            returned = wintypes.DWORD(0)
            kernel32.DeviceIoControl(
                self._disk, IOCTL_DISK_UPDATE_PROPERTIES, None, 0, None, 0,
                ctypes.byref(returned), None,
            )
            kernel32.CloseHandle(self._disk)
            self._disk = None
        for handle in self._volume_handles:
            returned = wintypes.DWORD(0)
            kernel32.DeviceIoControl(
                handle, FSCTL_UNLOCK_VOLUME, None, 0, None, 0,
                ctypes.byref(returned), None,
            )
            kernel32.CloseHandle(handle)
        self._volume_handles = []

    # -- setup -------------------------------------------------------------

    def _lock_volumes(self) -> None:
        """Lock and dismount every volume on the disk.

        Without this Windows refuses writes to sectors owned by a mounted
        filesystem - the ACCESS_DENIED that VDS reported as
        "Cannot zero sectors on disk ... Error code: 5".
        """
        for letter in volumes_on_disk(self.disk_number):
            raw = kernel32.CreateFileW(
                f"\\\\.\\{letter}:", GENERIC_READ | GENERIC_WRITE,
                FILE_SHARE_READ | FILE_SHARE_WRITE, None, OPEN_EXISTING, 0, None,
            )
            if not raw or raw == INVALID_HANDLE_VALUE:
                raise _win_error(
                    f"could not open volume {letter}: to lock it",
                    category=CAT_VOLUME_LOCK, operation=f"CreateFileW({letter}:)",
                )

            handle = wintypes.HANDLE(raw)
            returned = wintypes.DWORD(0)
            if not kernel32.DeviceIoControl(
                handle, FSCTL_LOCK_VOLUME, None, 0, None, 0,
                ctypes.byref(returned), None
            ):
                err = _win_error(
                    f"could not lock volume {letter}: - it is in use. Close Explorer "
                    f"windows, programs or antivirus scans using that drive",
                    category=CAT_VOLUME_LOCK, operation="FSCTL_LOCK_VOLUME",
                )
                kernel32.CloseHandle(handle)
                raise err

            if not kernel32.DeviceIoControl(
                handle, FSCTL_DISMOUNT_VOLUME, None, 0, None, 0,
                ctypes.byref(returned), None
            ):
                err = _win_error(
                    f"could not dismount volume {letter}:",
                    category=CAT_VOLUME_DISMOUNT, operation="FSCTL_DISMOUNT_VOLUME",
                )
                kernel32.CloseHandle(handle)
                raise err

            self._volume_handles.append(handle)
            self.locked_volumes.append(letter)
            logger.info("RAWDISK: locked and dismounted volume %s:", letter)

    def _open_disk(self) -> None:
        raw = kernel32.CreateFileW(
            self.device_path,
            GENERIC_READ | GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None, OPEN_EXISTING,
            FILE_FLAG_NO_BUFFERING | FILE_FLAG_WRITE_THROUGH,
            None,
        )
        if not raw or raw == INVALID_HANDLE_VALUE:
            raise _win_error(
                f"could not open {self.device_path} for writing",
                category=CAT_DEVICE_OPEN, operation="CreateFileW(PhysicalDrive)",
            )
        self._disk = wintypes.HANDLE(raw)

    def _query_size(self) -> int:
        """Device length via IOCTL_DISK_GET_LENGTH_INFO (GET_LENGTH_INFORMATION
        is a single LARGE_INTEGER - a 59 GB disk needs all 64 bits)."""
        length = ctypes.c_ulonglong(0)
        returned = wintypes.DWORD(0)
        if not kernel32.DeviceIoControl(
            self._disk, IOCTL_DISK_GET_LENGTH_INFO, None, 0,
            ctypes.byref(length), ctypes.sizeof(length),
            ctypes.byref(returned), None
        ):
            raise _win_error("could not determine device size", category=CAT_QUERY,
                             operation="IOCTL_DISK_GET_LENGTH_INFO")
        return int(length.value)

    def _query_sector_size(self) -> int:
        geo = DISK_GEOMETRY_EX()
        returned = wintypes.DWORD(0)
        if kernel32.DeviceIoControl(
            self._disk, IOCTL_DISK_GET_DRIVE_GEOMETRY_EX, None, 0,
            ctypes.byref(geo), ctypes.sizeof(geo), ctypes.byref(returned), None
        ):
            sector = int(geo.Geometry.BytesPerSector)
            if sector in (512, 1024, 2048, 4096):
                return sector
            logger.warning("RAWDISK: unexpected sector size %s, assuming 512", sector)
        else:
            logger.warning(
                "RAWDISK: IOCTL_DISK_GET_DRIVE_GEOMETRY_EX failed (Win32 %s), assuming 512",
                ctypes.get_last_error(),
            )
        return 512

    # -- operations --------------------------------------------------------

    def delete_drive_layout(self) -> None:
        """Drop the partition table so the disk comes back empty."""
        returned = wintypes.DWORD(0)
        if kernel32.DeviceIoControl(
            self._disk, IOCTL_DISK_DELETE_DRIVE_LAYOUT, None, 0, None, 0,
            ctypes.byref(returned), None
        ):
            logger.info("RAWDISK: partition table removed")
        else:
            # Not fatal: the overwrite below zeroes the table anyway.
            logger.warning(
                "RAWDISK: could not remove the partition table (Win32 error %s); "
                "the overwrite zeroes it regardless", ctypes.get_last_error(),
            )

    def _seek(self, offset: int) -> None:
        new_pos = wintypes.LARGE_INTEGER(0)
        if not kernel32.SetFilePointerEx(
            self._disk, wintypes.LARGE_INTEGER(offset), ctypes.byref(new_pos), FILE_BEGIN
        ):
            raise _win_error("seek failed", category=CAT_SEEK,
                             operation="SetFilePointerEx", offset=offset)

    def write_pattern(
        self,
        progress_cb: Optional[Callable[[int, int], None]] = None,
        chunk_size: int = 8 * 1024 * 1024,
        pattern: Optional[bytes] = None,
    ) -> int:
        """Write `pattern` (zeros by default) across the whole device.

        Returns bytes written; raises RawDiskError naming the exact byte offset
        if the device fails part-way, rather than reporting a partial write as
        success.
        """
        chunk_size = max(self.sector_size, (chunk_size // self.sector_size) * self.sector_size)
        buf = _AlignedBuffer(chunk_size)
        try:
            if pattern:
                buf.fill(pattern)
            else:
                buf.zero()

            self._seek(0)
            written_total = 0
            last_report = 0

            while written_total < self.size:
                remaining = self.size - written_total
                to_write = chunk_size if remaining >= chunk_size else remaining
                if to_write % self.sector_size:
                    to_write = (to_write // self.sector_size) * self.sector_size
                    if to_write == 0:
                        break

                written = wintypes.DWORD(0)
                if not kernel32.WriteFile(
                    self._disk, buf.ptr, wintypes.DWORD(to_write),
                    ctypes.byref(written), None
                ):
                    raise _win_error(
                        f"write failed after {written_total:,} of {self.size:,} bytes",
                        category=CAT_WRITE, operation="WriteFile", offset=written_total,
                    )
                if written.value == 0:
                    raise RawDiskError(
                        f"device accepted 0 bytes at offset {written_total:,} - "
                        f"it may have been removed",
                        category=CAT_DISCONNECTED, operation="WriteFile",
                        offset=written_total,
                    )

                written_total += int(written.value)
                if progress_cb and written_total - last_report >= 64 * 1024 * 1024:
                    last_report = written_total
                    progress_cb(written_total, self.size)

            self.flush()
            if progress_cb:
                progress_cb(written_total, self.size)
            return written_total
        finally:
            buf.release()

    def flush(self) -> None:
        if not kernel32.FlushFileBuffers(self._disk):
            raise _win_error("FlushFileBuffers failed", category=CAT_FLUSH,
                             operation="FlushFileBuffers")
        logger.info("RAWDISK: buffers flushed to media")

    def read(self, offset: int, length: int) -> bytes:
        """Read back through the same locked, unbuffered handle."""
        aligned_offset = (offset // self.sector_size) * self.sector_size
        skew = offset - aligned_offset
        span = length + skew
        if span % self.sector_size:
            span = ((span // self.sector_size) + 1) * self.sector_size

        buf = _AlignedBuffer(span)
        try:
            self._seek(aligned_offset)
            got = wintypes.DWORD(0)
            if not kernel32.ReadFile(
                self._disk, buf.ptr, wintypes.DWORD(span), ctypes.byref(got), None
            ):
                raise _win_error("read-back failed", category=CAT_READ,
                                 operation="ReadFile", offset=aligned_offset)
            data = buf.as_bytes(int(got.value))
            return data[skew:skew + length]
        finally:
            buf.release()
