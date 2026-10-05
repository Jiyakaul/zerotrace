"""Filesystem locations used by the backend.

Everything is anchored to the backend package directory rather than the
process working directory, so `uvicorn backend.main:app` (from the repo root)
and `uvicorn main:app` (from backend/) read and write the same data, reports
and keys instead of silently creating a second set.
"""

from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent

DATA_DIR = BACKEND_DIR / "data"
REPORTS_DIR = BACKEND_DIR / "reports"
KEYS_DIR = BACKEND_DIR / "keys"

FRONTEND_DIR = PROJECT_ROOT / "frontend" / "web"
FRONTEND_DIST = FRONTEND_DIR / "dist"


def ensure_dirs() -> None:
    """Create the writable directories the backend expects."""
    for d in (DATA_DIR, REPORTS_DIR, KEYS_DIR):
        d.mkdir(parents=True, exist_ok=True)
