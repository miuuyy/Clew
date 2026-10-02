"""Frozen desktop backend. The parent owns its lifetime and private launch token."""
from __future__ import annotations

import json
import os
from pathlib import Path
import socket
import sys
import threading

import uvicorn


def main() -> None:
    # Bind before announcing readiness, so there is no free-port race.
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    os.environ["KG_API_PORT"] = str(port)
    if not all(os.environ.get(key) for key in ("KG_DESKTOP_TOKEN", "KG_DB_PATH", "KG_DEBUG_LOG_DIR", "KG_FRONTEND_ORIGIN")):
        raise RuntimeError("The Clew launcher must supply its private session, database path, writable log directory (KG_DEBUG_LOG_DIR) and KG_FRONTEND_ORIGIN.")
    if os.environ["KG_FRONTEND_ORIGIN"] != "clew://app":
        raise RuntimeError("The desktop frontend origin must be clew://app.")
    if getattr(sys, "frozen", False):
        os.environ["KG_ROOT_DIR"] = str(Path(sys._MEIPASS))
    from app.main import create_app
    from app.core.config import Settings
    app = create_app(Settings())

    class DesktopServer(uvicorn.Server):
        async def startup(self, sockets=None):
            await super().startup(sockets=sockets)
            if self.started and not self.should_exit:
                print(json.dumps({"event": "ready", "port": port, "version": "1.0.0"}), flush=True)

    server = DesktopServer(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", access_log=False))

    def watch_launcher() -> None:
        # The launcher owns this pipe on every OS. EOF requests the same graceful
        # uvicorn lifecycle when the app quits normally or its parent crashes.
        try:
            while sys.stdin.buffer.read(1024):
                pass
        finally:
            server.should_exit = True

    threading.Thread(target=watch_launcher, name="clew-launcher-lifetime", daemon=True).start()
    try:
        server.run(sockets=[listener])
    finally:
        listener.close()


if __name__ == "__main__":
    main()
