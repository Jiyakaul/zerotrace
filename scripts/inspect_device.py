"""Read-only inspection of a physical device. Writes nothing, ever.

Samples the head, middle and tail of a device and reports how much of each
region is non-zero, with a hex dump of the first sector. Use it to confirm
whether a sanitisation actually took effect without running another wipe.

Needs an elevated terminal on Windows to open a raw device:

    .venv\\Scripts\\python.exe scripts\\inspect_device.py \\\\.\\PhysicalDrive2
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

MB = 1024 * 1024
SAMPLE = 1 * MB
ALIGN = 4096


def device_size(path):
    """Ask the disk driver for the size; os.path.getsize() reports 0 for raw devices."""
    if os.name == "nt" and "physicaldrive" in path.lower():
        try:
            import ctypes
            from ctypes import wintypes

            k32 = ctypes.windll.kernel32
            k32.CreateFileW.restype = wintypes.HANDLE
            k32.CreateFileW.argtypes = [
                wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE,
            ]
            INVALID = ctypes.c_void_p(-1).value
            h = k32.CreateFileW(path, 0x80000000, 0x1 | 0x2, None, 3, 0, None)
            if h and h != INVALID:
                try:
                    length = ctypes.c_ulonglong(0)
                    ret = wintypes.DWORD(0)
                    if k32.DeviceIoControl(wintypes.HANDLE(h), 0x0007405C, None, 0,
                                           ctypes.byref(length), ctypes.sizeof(length),
                                           ctypes.byref(ret), None):
                        return int(length.value), "IOCTL_DISK_GET_LENGTH_INFO"
                finally:
                    k32.CloseHandle(wintypes.HANDLE(h))
            else:
                err = ctypes.GetLastError()
                print(f"  ! CreateFileW failed (error {err})"
                      f"{' - run this from an elevated terminal' if err == 5 else ''}")
        except Exception as e:
            print(f"  ! size probe failed: {e}")
    try:
        s = os.path.getsize(path)
        if s:
            return s, "os.path.getsize"
    except Exception:
        pass
    return None, "unknown"


def sample(path, offset, length):
    with open(path, "rb", buffering=0) as f:      # read-only, unbuffered
        if offset:
            f.seek(offset)
        data = bytearray()
        while len(data) < length:
            chunk = f.read(length - len(data))
            if not chunk:
                break
            data.extend(chunk)
    return bytes(data)


def hexdump(data, base=0, rows=4):
    out = []
    for r in range(rows):
        off = r * 16
        if off >= len(data):
            break
        row = data[off:off + 16]
        hexpart = " ".join(f"{b:02x}" for b in row).ljust(47)
        txt = "".join(chr(b) if 32 <= b < 127 else "." for b in row)
        out.append(f"    {base + off:08x}  {hexpart}  |{txt}|")
    return "\n".join(out)


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    path = argv[1]

    print(f"\nREAD-ONLY inspection of {path}")
    print("=" * 72)

    size, how = device_size(path)
    print(f"  size: {size:,} bytes (via {how})" if size else f"  size: unknown (via {how})")

    if size and size > SAMPLE * 3:
        regions = [
            ("head", 0),
            ("middle", ((size // 2) // ALIGN) * ALIGN),
            ("tail", ((size - SAMPLE) // ALIGN) * ALIGN),
        ]
    else:
        regions = [("head", 0)]

    print()
    total_nonzero = 0
    for name, off in regions:
        try:
            data = sample(path, off, SAMPLE)
        except Exception as e:
            print(f"  {name:<7} offset={off:<14,} READ FAILED: {type(e).__name__}: {e}")
            continue
        nz = len(data) - data.count(0)
        total_nonzero += nz
        first = next((i for i, b in enumerate(data) if b), -1)
        verdict = "all zero" if nz == 0 else f"{nz:,} non-zero (first at +{first})"
        print(f"  {name:<7} offset={off:<14,} read={len(data):,} bytes  {verdict}")

    print()
    print("  First 64 bytes of sector 0:")
    try:
        head = sample(path, 0, 512)
        print(hexdump(head, 0, 4))
        sig = head[510:512]
        print(f"\n    MBR signature at 0x1FE: {sig.hex(' ')}"
              f"{'  <- valid MBR present (0x55AA)' if sig == b'\x55\xaa' else '  (absent)'}")
        nz_sector0 = 512 - head.count(0)
        print(f"    sector 0 non-zero bytes: {nz_sector0}")
    except Exception as e:
        print(f"    could not read sector 0: {e}")

    print()
    if total_nonzero == 0:
        print("  VERDICT: every sampled region is zero.")
    else:
        print(f"  VERDICT: {total_nonzero:,} non-zero bytes across sampled regions.")
        print("           If they sit only in sector 0 and look like an MBR, the data area")
        print("           was erased and Windows re-initialised the disk afterwards.")
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
