"""Programmatic uvicorn entry point.

Used for ordinary starts and, with --wait-for-port, by the elevated instance
launched through the Windows UAC flow. The elevated child has to wait for the
unprivileged parent to release the listening socket before it can bind to the
same host/port, which is what keeps the already-loaded frontend talking to the
same origin across the handover.

    python -m backend.server --host 127.0.0.1 --port 8000
    python -m backend.server --host 127.0.0.1 --port 8000 --wait-for-port
"""

import argparse
import logging
import os
import sys

# Allow `python backend/server.py` as well as `python -m backend.server`.
if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend import elevation  # noqa: E402  (path shim must run first)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("zerotrace.server")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Run the ZeroTrace backend.")
    parser.add_argument("--host", default=os.getenv("ZEROTRACE_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("ZEROTRACE_PORT", "8000")))
    parser.add_argument(
        "--wait-for-port",
        action="store_true",
        help="Wait for the port to be released by a previous instance before binding.",
    )
    parser.add_argument(
        "--wait-timeout",
        type=float,
        default=30.0,
        help="How long to wait for the port, in seconds.",
    )
    args = parser.parse_args(argv)

    banner = "elevated" if elevation.is_admin() else "standard"
    logger.info("Starting ZeroTrace backend (%s privileges) on %s:%s", banner, args.host, args.port)

    if args.wait_for_port:
        logger.info("Waiting for %s:%s to be released...", args.host, args.port)
        if not elevation.wait_for_port(args.host, args.port, timeout=args.wait_timeout):
            logger.error(
                "Port %s:%s is still in use after %.0fs - the previous instance did not exit.",
                args.host,
                args.port,
                args.wait_timeout,
            )
            return 1
        logger.info("Port released; binding now.")

    import uvicorn

    uvicorn.run("backend.main:app", host=args.host, port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
