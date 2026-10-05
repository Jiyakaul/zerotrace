"""Administrator / root privilege detection and Windows UAC elevation.

Physical-drive sanitisation needs raw block-device access, which Windows only
grants to a process running with an elevated token. Rather than failing deep
inside the wipe engine, the backend detects the requirement up front and can
relaunch itself through the *standard* Windows consent flow.

Design rules this module follows deliberately:

* Elevation goes through ShellExecuteW with the "runas" verb - the ordinary UAC
  mechanism. Nothing here bypasses, suppresses or weakens UAC, and there is no
  silent-elevation path: Windows always shows its consent dialog and the user
  must approve it.
* Elevation grants *capability*, never *authorisation*. Nothing in this module
  starts, resumes or queues a wipe. The destructive endpoint keeps its own
  independent `force=True` requirement and the UI keeps its typed-ERASE
  confirmation; both still have to happen after elevation.
* Privilege is always reported from the real process token via
  IsUserAnAdmin()/geteuid(). It is never inferred from the elevation request
  state, so a request outcome can never fake a privilege the process lacks.
"""

import ctypes
import logging
import os
import platform
import re
import socket
import sys
import threading
import time
from typing import Any, Dict, Optional

import paths

logger = logging.getLogger(__name__)

IS_WINDOWS = platform.system().lower() == "windows"

# ShellExecuteW returns a value <= 32 to signal failure. SE_ERR_ACCESSDENIED is
# what the shell reports when the user dismisses or denies the UAC dialog.
SE_ERR_ACCESSDENIED = 5
SW_SHOWMINNOACTIVE = 7

# States reported to the UI.
IDLE = "idle"
PENDING = "pending"
APPROVED = "approved"
DENIED = "denied"
FAILED = "failed"
UNSUPPORTED = "unsupported"

# Seconds the parent waits after an approved prompt before exiting, so the
# elevated child can take the listening socket over.
_HANDOVER_DELAY = 0.8


def is_admin() -> bool:
    """True when this process actually holds administrator/root privileges.

    Read straight from the OS every call - never cached and never derived from
    the elevation request state.
    """
    try:
        if IS_WINDOWS:
            return bool(ctypes.windll.shell32.IsUserAnAdmin())
        return os.geteuid() == 0
    except Exception as e:  # pragma: no cover - defensive
        logger.warning(f"Could not determine privilege level: {e}")
        return False


def elevation_supported() -> bool:
    """Only Windows has a UAC flow we can drive from inside the app."""
    return IS_WINDOWS


def device_requires_elevation(device_path: str) -> bool:
    """Whether sanitising this target needs an elevated process.

    Whole-disk and volume targets need raw device access; the demo placeholder
    and ordinary file paths do not.
    """
    if not device_path:
        return False

    target = str(device_path).strip()
    if target.startswith("demo://"):
        return False

    if IS_WINDOWS:
        # \\.\PhysicalDrive0 style targets, or a bare volume such as "D:" / "D:\"
        if re.search(r"PhysicalDrive\d+", target, re.IGNORECASE):
            return True
        return bool(re.match(r"^[a-zA-Z]:\\?$", target))

    return target.startswith("/dev/")


class _ElevationTracker:
    """Thread-safe record of the most recent elevation request."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._state = IDLE
        self._message = ""
        self._requested_at: Optional[float] = None
        self._resolved_at: Optional[float] = None

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "state": self._state,
                "message": self._message,
                "requested_at": self._requested_at,
                "resolved_at": self._resolved_at,
            }

    def set(self, state: str, message: str = "") -> None:
        with self._lock:
            self._state = state
            self._message = message
            if state == PENDING:
                self._requested_at = time.time()
                self._resolved_at = None
            else:
                self._resolved_at = time.time()

    def is_pending(self) -> bool:
        with self._lock:
            return self._state == PENDING

    def reset_if_stale(self, max_age: float = 180.0) -> None:
        """Release a prompt the user walked away from so the UI is not stuck."""
        with self._lock:
            if (
                self._state == PENDING
                and self._requested_at
                and time.time() - self._requested_at > max_age
            ):
                self._state = FAILED
                self._message = "The elevation request timed out with no response."
                self._resolved_at = time.time()


tracker = _ElevationTracker()


def _shell_execute_runas(host: str, port: int) -> int:
    """Ask Windows to start an elevated copy of the backend. Blocks on the UAC prompt."""
    # The elevated child waits for this process to release the port, then serves
    # exactly the same ASGI app on the same host/port so the already-loaded
    # frontend keeps talking to the same origin.
    params = (
        f'-m backend.server --host {host} --port {int(port)} --wait-for-port'
    )

    logger.info("Requesting elevation via UAC: %s %s", sys.executable, params)

    result = ctypes.windll.shell32.ShellExecuteW(
        None,               # hwnd
        "runas",            # verb -> standard UAC consent prompt
        sys.executable,     # the interpreter running this backend (venv aware)
        params,
        str(paths.PROJECT_ROOT),
        SW_SHOWMINNOACTIVE,
    )
    return int(result)


def _shutdown_for_handover() -> None:
    """Release the port shortly after an approved prompt so the child can bind."""
    def _exit() -> None:
        time.sleep(_HANDOVER_DELAY)
        logger.info("Elevated instance approved - releasing port for handover")
        for handler in logging.getLogger().handlers:
            try:
                handler.flush()
            except Exception:
                pass
        # Hard exit: uvicorn's graceful shutdown can keep the socket in a state
        # that delays the child's bind, and the child is already waiting for it.
        os._exit(0)

    threading.Thread(target=_exit, name="zerotrace-handover", daemon=True).start()


def _worker(host: str, port: int) -> None:
    try:
        # Test hook, denial paths only. It can simulate a user declining the
        # prompt so the failure UI can be exercised without a real dialog; it
        # can never report success, and it never touches is_admin().
        simulate = os.getenv("ZEROTRACE_ELEVATION_TEST", "").strip().lower()
        if simulate in {"deny", "denied"}:
            time.sleep(0.6)
            tracker.set(DENIED, "Administrator access was declined at the Windows prompt.")
            logger.warning("Elevation denied (simulated via ZEROTRACE_ELEVATION_TEST)")
            return
        if simulate in {"fail", "failed"}:
            time.sleep(0.6)
            tracker.set(FAILED, "Windows could not start the elevated process. (simulated)")
            return
        if simulate == "handover":
            # Exercises the restart/port-handover path with no UAC dialog: the
            # replacement is spawned WITHOUT the runas verb, so it inherits this
            # same unprivileged token. is_admin() still reads the real token, so
            # the UI must (correctly) keep reporting that privileges were not
            # obtained. This hook cannot manufacture privilege.
            import subprocess

            time.sleep(0.5)
            subprocess.Popen(
                [sys.executable, "-m", "backend.server", "--host", host,
                 "--port", str(port), "--wait-for-port"],
                cwd=str(paths.PROJECT_ROOT),
                creationflags=getattr(subprocess, "DETACHED_PROCESS", 0),
                close_fds=True,
            )
            tracker.set(APPROVED, "Restarting (simulated handover, no privilege change).")
            logger.warning("Simulated handover via ZEROTRACE_ELEVATION_TEST=handover")
            _shutdown_for_handover()
            return

        result = _shell_execute_runas(host, port)

        if result > 32:
            tracker.set(
                APPROVED,
                "Administrator access granted. Restarting ZeroTrace with elevated privileges.",
            )
            logger.info("Elevation approved (ShellExecuteW -> %s)", result)
            _shutdown_for_handover()
        elif result == SE_ERR_ACCESSDENIED:
            tracker.set(DENIED, "Administrator access was declined at the Windows prompt.")
            logger.warning("Elevation denied by user (ShellExecuteW -> %s)", result)
        else:
            tracker.set(
                FAILED,
                f"Windows could not start the elevated process (error {result}).",
            )
            logger.error("Elevation failed (ShellExecuteW -> %s)", result)
    except Exception as e:  # pragma: no cover - defensive
        tracker.set(FAILED, f"Elevation request failed: {e}")
        logger.exception("Elevation request raised")


def request_elevation(host: str, port: int) -> Dict[str, Any]:
    """Kick off a UAC request. Returns immediately; poll status() for the outcome."""
    if is_admin():
        tracker.set(APPROVED, "Already running with administrator privileges.")
        return status(host, port)

    if not elevation_supported():
        tracker.set(
            UNSUPPORTED,
            "In-app elevation is only available on Windows. Restart the backend with sudo.",
        )
        return status(host, port)

    tracker.reset_if_stale()
    if tracker.is_pending():
        return status(host, port)

    tracker.set(PENDING, "Waiting for Windows to confirm administrator access.")
    threading.Thread(
        target=_worker, args=(host, int(port)), name="zerotrace-elevation", daemon=True
    ).start()
    return status(host, port)


def status(host: str = "127.0.0.1", port: int = 8000) -> Dict[str, Any]:
    """Current privilege and elevation-request state for the UI."""
    tracker.reset_if_stale()
    admin = is_admin()
    snap = tracker.snapshot()

    # Never let a request outcome imply privilege - the token is the only source
    # of truth. If we are already elevated, say so regardless of request state.
    if admin and snap["state"] in {IDLE, PENDING, DENIED, FAILED}:
        snap = dict(snap, state=APPROVED, message="Running with administrator privileges.")

    return {
        "platform": platform.system(),
        "is_admin": admin,
        "elevation_supported": elevation_supported(),
        "host": host,
        "port": int(port),
        "elevation": snap,
        # Elevation grants capability only. The destructive endpoint still
        # requires force=True and the UI still requires the typed confirmation.
        "elevation_grants_wipe_authorisation": False,
    }


def port_is_free(host: str, port: int) -> bool:
    """True when nothing is listening on host:port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.4)
        return sock.connect_ex((host, int(port))) != 0


def wait_for_port(host: str, port: int, timeout: float = 30.0) -> bool:
    """Block until host:port is free (the previous instance has exited)."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if port_is_free(host, port):
            return True
        time.sleep(0.25)
    return port_is_free(host, port)
