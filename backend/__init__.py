"""ZeroTrace backend package.

The modules in this package import each other as top-level modules
(`from routes.api import ...`, `from database import ...`), which only resolves
when the process working directory is backend/. Putting this directory on
sys.path lets the documented `uvicorn backend.main:app` entry point work from
the repository root as well, without rewriting every import.
"""

import os
import sys

_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)
