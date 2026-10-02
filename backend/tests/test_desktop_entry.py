from __future__ import annotations

import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen


class DesktopEntryTests(unittest.TestCase):
    def launch_environment(self, root):
        environment = {key: value for key, value in os.environ.items() if not key.startswith("KG_")}
        environment.update(KG_DESKTOP_TOKEN="test-launch-session", KG_DB_PATH=str(root / "state.sqlite3"),
                           KG_ROOT_DIR=str(Path(__file__).resolve().parents[2]), KG_FRONTEND_ORIGIN="clew://app")
        return environment

    def test_launcher_requires_an_explicit_writable_log_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / "desktop_entry.py")],
                env=self.launch_environment(Path(directory)), capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("KG_DEBUG_LOG_DIR", result.stderr)
        self.assertNotIn('"event": "ready"', result.stdout)

    def test_native_backend_readiness_and_private_launch_boundary(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            environment = self.launch_environment(root)
            environment.update(KG_DEBUG_LOG_DIR=str(root / "logs"))
            process = subprocess.Popen([sys.executable, str(Path(__file__).resolve().parents[1] / "desktop_entry.py")],
                env=environment, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            ready = queue.Queue()
            threading.Thread(target=lambda: ready.put(process.stdout.readline()), daemon=True).start()
            try:
                message = json.loads(ready.get(timeout=15))
                self.assertEqual(message["event"], "ready")
                self.assertEqual(message["version"], "1.0.0")
                base = f"http://127.0.0.1:{message['port']}"
                with urlopen(base + "/healthz", timeout=5) as response:
                    self.assertTrue(json.load(response)["ok"])
                    self.assertIn("default-src 'self'", response.headers["Content-Security-Policy"])
                with self.assertRaises(HTTPError) as root_request:
                    urlopen(base, timeout=5)
                self.assertEqual(root_request.exception.code, 404)
                with self.assertRaises(HTTPError) as raised:
                    urlopen(base + "/api/v1/chatgpt/account", timeout=5)
                self.assertEqual(raised.exception.code, 403)
                request = Request(base + "/api/v1/chatgpt/account", method="OPTIONS", headers={
                    "Origin": "clew://app", "Access-Control-Request-Method": "GET",
                    "Access-Control-Request-Headers": "x-clew-session"})
                with urlopen(request, timeout=5) as response:
                    self.assertEqual(response.headers["Access-Control-Allow-Origin"], "clew://app")
                self.assertTrue((root / "state.sqlite3").is_file())
                self.assertTrue((root / "logs").is_dir())
            finally:
                process.stdin.close()
                process.stdin = None
                try:
                    process.communicate(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.communicate(timeout=5)
            self.assertEqual(process.returncode, 0, "Launcher EOF must stop the backend gracefully.")

    def test_native_backend_rejects_an_unowned_frontend_origin(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            environment = self.launch_environment(root)
            environment.update(KG_DEBUG_LOG_DIR=str(root / "logs"), KG_FRONTEND_ORIGIN="https://example.test")
            result = subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / "desktop_entry.py")],
                env=environment, capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("clew://app", result.stderr)
        self.assertNotIn('"event": "ready"', result.stdout)
