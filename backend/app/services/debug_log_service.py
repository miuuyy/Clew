from __future__ import annotations

import json
import re
import threading
import uuid
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field


DebugLogKind = Literal["frontend", "api", "server"]
DebugLogLevel = Literal["info", "error"]
SENSITIVE_FIELD_PATTERN = re.compile(r"(api[_-]?key|token|secret|password|authorization)", re.IGNORECASE)
PRIVATE_TEXT_FIELDS = {
    "assistant_message",
    "content",
    "messages",
    "persona_rules",
    "prompt",
    "raw_text",
    "reply_message",
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clip_text(value: object, limit: int = 4000) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if len(text) <= limit:
        return text
    return f"{text[:limit]}…"


def _summarize_private_text(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        return ""
    return f"[redacted text {len(normalized)} chars]"


def _redact_secret_patterns(text: str) -> str:
    redacted = text
    redacted = re.sub(
        r'("?(?:gemini_api_key|openai_api_key|api[_-]?key|authorization|token|secret|password)"?\s*[:=]\s*)(".*?"|\'.*?\'|[^,\s}]+)',
        r"\1[redacted]",
        redacted,
        flags=re.IGNORECASE,
    )
    redacted = re.sub(r"Bearer\s+[A-Za-z0-9._\-]+", "Bearer [redacted]", redacted, flags=re.IGNORECASE)
    return redacted


def _sanitize_debug_value(
    value: object,
    field_name: str | None = None,
    *,
    preserve_private_text: bool = False,
) -> object:
    if field_name and SENSITIVE_FIELD_PATTERN.search(field_name):
        return "[redacted]"
    if isinstance(value, dict):
        return {
            key: _sanitize_debug_value(item, key, preserve_private_text=preserve_private_text)
            for key, item in value.items()
        }
    if isinstance(value, list):
        if field_name == "messages" and not preserve_private_text:
            return f"[{len(value)} messages redacted]"
        items = value if preserve_private_text else value[:5]
        return [_sanitize_debug_value(item, preserve_private_text=preserve_private_text) for item in items]
    if isinstance(value, str):
        redacted = _redact_secret_patterns(value)
        if field_name in PRIVATE_TEXT_FIELDS and not preserve_private_text:
            return _summarize_private_text(redacted)
        return redacted
    return value


def _sanitize_debug_text(value: object, *, preserve_private_text: bool = False, limit: int = 4000) -> str | None:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return _clip_json(value, limit=limit, preserve_private_text=preserve_private_text)
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
    except Exception:
        return _clip_text(_redact_secret_patterns(text), limit=limit)
    return _clip_json(parsed, limit=limit, preserve_private_text=preserve_private_text)


def _clip_json(value: object, limit: int = 4000, *, preserve_private_text: bool = False) -> str | None:
    if value is None:
        return None
    try:
        encoded = json.dumps(
            _sanitize_debug_value(value, preserve_private_text=preserve_private_text),
            ensure_ascii=False,
            separators=(",", ":"),
        )
    except Exception:
        encoded = str(_sanitize_debug_value(value, preserve_private_text=preserve_private_text))
    return _clip_text(encoded, limit=limit)


class DebugLogEntry(BaseModel):
    id: str = Field(default_factory=lambda: f"log_{uuid.uuid4().hex[:12]}")
    created_at: str = Field(default_factory=_utc_now)
    kind: DebugLogKind
    level: DebugLogLevel
    title: str
    message: str
    method: str | None = None
    path: str | None = None
    status_code: int | None = None
    duration_ms: int | None = None
    request_excerpt: str | None = None
    response_excerpt: str | None = None
    stack: str | None = None


class DebugClientLogRequest(BaseModel):
    kind: Literal["frontend", "api"]
    level: DebugLogLevel = "info"
    title: str
    message: str
    method: str | None = None
    path: str | None = None
    status_code: int | None = None
    duration_ms: int | None = None
    request_excerpt: str | None = None
    response_excerpt: str | None = None
    stack: str | None = None


class DebugLogSnapshot(BaseModel):
    file_path: str
    frontend: list[DebugLogEntry]
    api: list[DebugLogEntry]
    server: list[DebugLogEntry]


class DebugLogService:
    def __init__(self, file_path: Path, max_entries: int = 120) -> None:
        self.file_path = file_path
        self.file_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._streams: dict[DebugLogKind, deque[DebugLogEntry]] = {
            "frontend": deque(maxlen=max_entries),
            "api": deque(maxlen=max_entries),
            "server": deque(maxlen=max_entries),
        }

    def snapshot(self) -> DebugLogSnapshot:
        with self._lock:
            return DebugLogSnapshot(
                file_path=str(self.file_path),
                frontend=list(self._streams["frontend"]),
                api=list(self._streams["api"]),
                server=list(self._streams["server"]),
            )

    def ingest_client_entry(self, request: DebugClientLogRequest) -> DebugLogEntry:
        entry = DebugLogEntry(
            kind=request.kind,
            level=request.level,
            title=request.title,
            message=request.message,
            method=request.method,
            path=request.path,
            status_code=request.status_code,
            duration_ms=request.duration_ms,
            request_excerpt=_sanitize_debug_text(request.request_excerpt, preserve_private_text=True),
            response_excerpt=_sanitize_debug_text(request.response_excerpt, preserve_private_text=True),
            stack=_clip_text(request.stack, limit=8000),
        )
        self._append(entry)
        return entry

    def log_server_error(
        self,
        *,
        title: str,
        message: str,
        method: str | None = None,
        path: str | None = None,
        status_code: int | None = None,
        duration_ms: int | None = None,
        request_payload: object | None = None,
        response_payload: object | None = None,
        stack: str | None = None,
        preserve_private_payload: bool = True,
    ) -> DebugLogEntry:
        payload_limit = 120000 if preserve_private_payload else 4000
        entry = DebugLogEntry(
            kind="server",
            level="error",
            title=title,
            message=message,
            method=method,
            path=path,
            status_code=status_code,
            duration_ms=duration_ms,
            request_excerpt=_clip_json(
                request_payload,
                limit=payload_limit,
                preserve_private_text=preserve_private_payload,
            ),
            response_excerpt=_clip_json(
                response_payload,
                limit=payload_limit,
                preserve_private_text=preserve_private_payload,
            ),
            stack=_clip_text(stack, limit=8000),
        )
        self._append(entry)
        return entry

    def _append(self, entry: DebugLogEntry) -> None:
        line = json.dumps(entry.model_dump(mode="json"), ensure_ascii=False)
        with self._lock:
            self._streams[entry.kind].appendleft(entry)
            with self.file_path.open("a", encoding="utf-8") as handle:
                handle.write(f"{line}\n")


_services: dict[Path, DebugLogService] = {}
_services_lock = threading.Lock()


def get_debug_log_service(log_dir: Path) -> DebugLogService:
    file_path = log_dir / "logs.log"
    with _services_lock:
        service = _services.get(file_path)
        if service is None:
            service = DebugLogService(file_path=file_path)
            _services[file_path] = service
        return service
