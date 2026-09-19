from __future__ import annotations

import asyncio
import json
import os
import shutil
from collections import deque
from collections.abc import Awaitable, Callable
from typing import Any

from app.core.config import Settings


class CodexError(RuntimeError):
    pass


class CodexTransport:
    """One owned app-server process. JSON-RPC requests never block its reader."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.process: asyncio.subprocess.Process | None = None
        self.on_notification: Callable[[str, dict], Awaitable[None]] | None = None
        self.on_request: Callable[[str, dict], Awaitable[dict]] | None = None
        self.on_disconnect: Callable[[str], Awaitable[None]] | None = None
        self._start_lock = asyncio.Lock()
        self._write_lock = asyncio.Lock()
        self._pending: dict[int, asyncio.Future] = {}
        self._sequence = 0
        self._reader: asyncio.Task | None = None
        self._stderr: asyncio.Task | None = None
        self._requests: set[asyncio.Task] = set()
        self._closing = False
        self.version = ""
        self.diagnostics: deque[str] = deque(maxlen=12)

    async def start(self) -> None:
        async with self._start_lock:
            if self.process is not None and self.process.returncode is None:
                return
            binary = shutil.which(self.settings.codex_binary)
            if not binary:
                raise CodexError("Codex CLI was not found. Install Codex or set KG_CODEX_BINARY, then reconnect.")
            self.settings.codex_home.mkdir(parents=True, exist_ok=True, mode=0o700)
            self.settings.codex_workspace.mkdir(parents=True, exist_ok=True)
            (self.settings.codex_workspace / ".clew-agent-root").touch(exist_ok=True)
            env = os.environ.copy()
            # Clew owns this Codex home; it never imports or modifies the user's MCP configuration.
            env["CODEX_HOME"] = str(self.settings.codex_home.resolve())
            for key in ("OPENAI_API_KEY", "GEMINI_API_KEY", "KG_OPENAI_API_KEY", "KG_GEMINI_API_KEY"):
                env.pop(key, None)
            args = [binary, "app-server", "--listen", "stdio://", "--strict-config"]
            for feature in (
                "shell_tool", "unified_exec", "multi_agent", "apps", "plugins",
                "computer_use", "browser_use", "browser_use_external", "in_app_browser",
                "image_generation", "view_image", "code_mode", "code_mode_host",
                "memories", "hooks", "goals", "sleep_tool", "workspace_dependencies",
                "skill_search", "tool_suggest", "remote_plugin", "skill_mcp_dependency_install",
            ):
                args.extend(["--disable", feature])
            args.extend(["--enable", "skip_host_skill_discovery", "-c", 'approval_policy="never"',
                         "-c", 'sandbox_mode="read-only"', "-c", 'project_root_markers=[".clew-agent-root"]',
                         "-c", 'project_doc_max_bytes=0', "-c", 'cli_auth_credentials_store="file"',
                         "-c", 'forced_login_method="chatgpt"'])
            self._closing = False
            try:
                self.process = await asyncio.create_subprocess_exec(
                    *args, cwd=self.settings.codex_workspace, env=env,
                    stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE, limit=32 * 1024 * 1024,
                )
                self._reader = asyncio.create_task(self._read(self.process))
                self._stderr = asyncio.create_task(self._read_stderr(self.process))
                result = await self.request("initialize", {
                    "clientInfo": {"name": "clew", "title": "Clew", "version": "0.2.1"},
                    "capabilities": {"experimentalApi": True},
                })
                self.version = str(result.get("userAgent", ""))
                await self.notify("initialized", {})
                effective = await self.request("config/read", {"cwd": str(self.settings.codex_workspace.resolve()), "includeLayers": False})
                if (effective.get("config") or {}).get("mcp_servers"):
                    raise CodexError("Clew requires a dedicated Codex home without MCP servers. Choose an empty KG_CODEX_HOME and reconnect.")
            except OSError as exc:
                await self.close()
                raise CodexError(f"Could not start Codex: {exc}") from exc
            except Exception:
                await self.close()
                raise

    async def request(self, method: str, params: Any) -> dict:
        if self.process is None or self.process.returncode is not None:
            raise CodexError("Codex is not connected.")
        self._sequence += 1
        request_id = self._sequence
        future = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        try:
            await self._write({"id": request_id, "method": method, "params": params})
            return await asyncio.wait_for(future, self.settings.codex_rpc_timeout_seconds)
        except TimeoutError as exc:
            reason = f"Codex did not acknowledge {method}. Its connection was closed; the request was not retried."
            if self.on_disconnect:
                await self.on_disconnect(reason)
            await self.close()
            raise CodexError(reason) from exc
        finally:
            self._pending.pop(request_id, None)

    async def notify(self, method: str, params: Any) -> None:
        await self._write({"method": method, "params": params})

    async def _write(self, payload: dict) -> None:
        async with self._write_lock:
            process = self.process
            if process is None or process.returncode is not None or process.stdin is None:
                raise CodexError("Codex connection closed.")
            process.stdin.write((json.dumps(payload, ensure_ascii=False) + "\n").encode())
            try:
                await process.stdin.drain()
            except (BrokenPipeError, ConnectionResetError) as exc:
                raise CodexError("Codex connection closed.") from exc

    async def _read(self, process: asyncio.subprocess.Process) -> None:
        reason = "Codex process stopped. Continue the conversation to reconnect."
        try:
            assert process.stdout is not None
            async for line in process.stdout:
                if not line.strip():
                    continue
                message = json.loads(line)
                if not isinstance(message, dict):
                    raise CodexError("Invalid app-server message.")
                if "method" in message:
                    if "id" in message:
                        task = asyncio.create_task(self._handle_request(message))
                        self._requests.add(task)
                        task.add_done_callback(self._requests.discard)
                    elif self.on_notification:
                        await self.on_notification(message["method"], message.get("params") or {})
                elif "id" in message:
                    future = self._pending.get(message["id"])
                    if future is None or future.done():
                        continue
                    if "error" in message:
                        error = message["error"]
                        future.set_exception(CodexError(str(error.get("message", "Codex request failed"))))
                    else:
                        future.set_result(message.get("result") or {})
        except asyncio.CancelledError:
            return
        except Exception as exc:
            reason = f"Codex transport failed: {exc}"
        finally:
            if not self._closing and process.returncode is None:
                process.terminate()
                await process.wait()
            for future in list(self._pending.values()):
                if not future.done():
                    future.set_exception(CodexError(reason))
            if not self._closing and self.on_disconnect:
                await self.on_disconnect(reason)

    async def _handle_request(self, message: dict) -> None:
        try:
            if self.on_request is None:
                raise CodexError("No Clew tool handler is attached.")
            result = await self.on_request(message["method"], message.get("params") or {})
            await self._write({"id": message["id"], "result": result})
        except asyncio.CancelledError:
            return
        except Exception as exc:
            try:
                await self._write({"id": message["id"], "error": {"code": -32000, "message": str(exc)}})
            except CodexError:
                pass

    async def _read_stderr(self, process: asyncio.subprocess.Process) -> None:
        assert process.stderr is not None
        try:
            async for line in process.stderr:
                self.diagnostics.append(line.decode(errors="replace").strip()[:1000])
        except asyncio.CancelledError:
            return

    async def close(self) -> None:
        self._closing = True
        for task in list(self._requests):
            task.cancel()
        if self._requests:
            await asyncio.gather(*self._requests, return_exceptions=True)
        process = self.process
        if process is not None and process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), 3)
            except TimeoutError:
                process.kill()
                await process.wait()
        current = asyncio.current_task()
        for task in (self._reader, self._stderr):
            if task is not None and task is not current:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
        for future in list(self._pending.values()):
            if not future.done():
                future.set_exception(CodexError("Codex connection closed."))
        self.process = None
