from __future__ import annotations

import json
import sqlite3
from copy import deepcopy
from datetime import datetime, timezone

from app.models.domain import SnapshotRecord, WorkspaceDocument, WorkspaceEnvelope
from app.services.bootstrap import build_seed_workspace
from app.services.zone_style_service import normalize_workspace_zone_styles


def init_repository_storage(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS graph_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            source TEXT NOT NULL,
            reason TEXT,
            parent_snapshot_id INTEGER,
            payload_json TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS graph_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload_json TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS quiz_sessions (
            session_id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            graph_id TEXT NOT NULL,
            topic_id TEXT NOT NULL,
            payload_json TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS chat_sessions (
            session_id TEXT PRIMARY KEY,
            graph_id TEXT NOT NULL,
            topic_id TEXT,
            title TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS chat_messages (
            ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT NOT NULL UNIQUE,
            session_id TEXT NOT NULL,
            graph_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            role TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            FOREIGN KEY(session_id) REFERENCES chat_sessions(session_id)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS workspace_secrets (
            workspace_id TEXT PRIMARY KEY,
            gemini_api_key TEXT,
            openai_api_key TEXT,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_chat_messages_graph ON chat_messages(graph_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_chat_sessions_graph ON chat_sessions(graph_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_quiz_sessions_graph_topic ON quiz_sessions(graph_id, topic_id)")
    _migrate_chat_sessions_schema(conn)
    migrate_workspace_secrets(conn)
    migrate_zone_styles(conn)


def ensure_seed_snapshot(conn: sqlite3.Connection) -> None:
    row = conn.execute("SELECT id FROM graph_snapshots ORDER BY id DESC LIMIT 1").fetchone()
    if row is None:
        insert_snapshot(
            conn,
            build_seed_workspace(),
            source="seed",
            reason="bootstrap workspace",
            parent_snapshot_id=None,
        )


def insert_snapshot(
    conn: sqlite3.Connection,
    workspace: WorkspaceDocument,
    *,
    source: str,
    reason: str | None,
    parent_snapshot_id: int | None,
) -> int:
    payload_json = snapshot_workspace_document(workspace).model_dump_json()
    cursor = conn.execute(
        """
        INSERT INTO graph_snapshots (created_at, source, reason, parent_snapshot_id, payload_json)
        VALUES (?, ?, ?, ?, ?)
        """,
        (datetime.now(timezone.utc).isoformat(), source, reason, parent_snapshot_id, payload_json),
    )
    return int(cursor.lastrowid)


def load_current_workspace(conn: sqlite3.Connection) -> WorkspaceEnvelope:
    row = conn.execute(
        """
        SELECT id, created_at, source, reason, parent_snapshot_id, payload_json
        FROM graph_snapshots
        ORDER BY id DESC
        LIMIT 1
        """
    ).fetchone()
    if row is None:
        raise RuntimeError("graph snapshot missing")
    return _workspace_envelope_from_row(conn, row)


def load_workspace_snapshot(conn: sqlite3.Connection, snapshot_id: int) -> WorkspaceEnvelope:
    row = conn.execute(
        """
        SELECT id, created_at, source, reason, parent_snapshot_id, payload_json
        FROM graph_snapshots
        WHERE id = ?
        """,
        (snapshot_id,),
    ).fetchone()
    if row is None:
        raise KeyError(snapshot_id)
    return _workspace_envelope_from_row(conn, row)


def list_snapshot_records(conn: sqlite3.Connection, limit: int = 20) -> list[SnapshotRecord]:
    rows = conn.execute(
        """
        SELECT id, created_at, source, reason, parent_snapshot_id
        FROM graph_snapshots
        ORDER BY id DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return [_snapshot_record_from_row(row) for row in rows]


def purge_graph_runtime_state(conn: sqlite3.Connection, graph_id: str) -> None:
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "agent_sessions" in tables:
        conn.execute("DELETE FROM agent_tool_results WHERE thread_id IN (SELECT thread_id FROM agent_sessions WHERE session_id IN (SELECT session_id FROM chat_sessions WHERE graph_id=?))", (graph_id,))
        conn.execute("DELETE FROM agent_events WHERE session_id IN (SELECT session_id FROM chat_sessions WHERE graph_id=?)", (graph_id,))
        conn.execute("DELETE FROM agent_sessions WHERE session_id IN (SELECT session_id FROM chat_sessions WHERE graph_id=?)", (graph_id,))
    conn.execute("DELETE FROM chat_messages WHERE graph_id = ?", (graph_id,))
    conn.execute("DELETE FROM chat_sessions WHERE graph_id = ?", (graph_id,))
    conn.execute("DELETE FROM quiz_sessions WHERE graph_id = ?", (graph_id,))


def snapshot_workspace_document(workspace: WorkspaceDocument) -> WorkspaceDocument:
    sanitized = WorkspaceDocument.model_validate(deepcopy(workspace.model_dump()))
    return sanitized


def workspace_document_from_snapshot_row(conn: sqlite3.Connection, row: sqlite3.Row) -> WorkspaceDocument:
    workspace = WorkspaceDocument.model_validate_json(row["payload_json"])
    return workspace


def migrate_workspace_secrets(conn: sqlite3.Connection) -> None:
    rows = conn.execute(
        """
        SELECT id, payload_json
        FROM graph_snapshots
        ORDER BY id ASC
        """
    ).fetchall()
    latest_secrets_by_workspace: dict[str, dict[str, str | None]] = {}
    snapshot_updates: list[tuple[str, int]] = []

    for row in rows:
        try:
            payload = json.loads(row["payload_json"])
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict):
            continue
        workspace_id = str(payload.get("workspace_id") or "default")
        config = payload.get("config")
        if not isinstance(config, dict):
            continue

        gemini_api_key = normalized_secret_value(config.get("gemini_api_key"))
        openai_api_key = normalized_secret_value(config.get("openai_api_key"))
        if gemini_api_key is not None or openai_api_key is not None:
            latest_secrets_by_workspace[workspace_id] = {
                "gemini_api_key": gemini_api_key,
                "openai_api_key": openai_api_key,
            }

        changed = False
        if config.get("gemini_api_key") is not None:
            config["gemini_api_key"] = None
            changed = True
        if config.get("openai_api_key") is not None:
            config["openai_api_key"] = None
            changed = True
        if changed:
            snapshot_updates.append((json.dumps(payload, ensure_ascii=False, separators=(",", ":")), int(row["id"])))

    for workspace_id, secrets in latest_secrets_by_workspace.items():
        conn.execute(
            """
            INSERT INTO workspace_secrets (workspace_id, gemini_api_key, openai_api_key, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(workspace_id) DO UPDATE SET
                gemini_api_key = COALESCE(excluded.gemini_api_key, workspace_secrets.gemini_api_key),
                openai_api_key = COALESCE(excluded.openai_api_key, workspace_secrets.openai_api_key),
                updated_at = excluded.updated_at
            """,
            (
                workspace_id,
                secrets["gemini_api_key"],
                secrets["openai_api_key"],
                datetime.now(timezone.utc).isoformat(),
            ),
        )

    if snapshot_updates:
        conn.executemany(
            "UPDATE graph_snapshots SET payload_json = ? WHERE id = ?",
            snapshot_updates,
        )


def normalized_secret_value(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def migrate_zone_styles(conn: sqlite3.Connection) -> None:
    rows = conn.execute(
        """
        SELECT id, payload_json
        FROM graph_snapshots
        ORDER BY id ASC
        """
    ).fetchall()
    snapshot_updates: list[tuple[str, int]] = []

    for row in rows:
        try:
            workspace = WorkspaceDocument.model_validate_json(row["payload_json"])
        except Exception:
            continue
        if not normalize_workspace_zone_styles(workspace):
            continue
        snapshot_updates.append((snapshot_workspace_document(workspace).model_dump_json(), int(row["id"])))

    if snapshot_updates:
        conn.executemany(
            "UPDATE graph_snapshots SET payload_json = ? WHERE id = ?",
            snapshot_updates,
        )


def _migrate_chat_sessions_schema(conn: sqlite3.Connection) -> None:
    schema_sql = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='chat_sessions'"
    ).fetchone()
    if schema_sql and "UNIQUE" in str(schema_sql[0]):
        conn.execute("ALTER TABLE chat_sessions RENAME TO _chat_sessions_old")
        conn.execute(
            """
            CREATE TABLE chat_sessions (
                session_id TEXT PRIMARY KEY,
                graph_id TEXT NOT NULL,
                topic_id TEXT,
                title TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            INSERT INTO chat_sessions (session_id, graph_id, topic_id, title, created_at, updated_at)
            SELECT session_id, graph_id, NULL, NULL, created_at, updated_at
            FROM _chat_sessions_old
            """
        )
        conn.execute("DROP TABLE _chat_sessions_old")
        return

    cols = {row[1] for row in conn.execute("PRAGMA table_info(chat_sessions)").fetchall()}
    if "topic_id" not in cols:
        conn.execute("ALTER TABLE chat_sessions ADD COLUMN topic_id TEXT")
    if "title" not in cols:
        conn.execute("ALTER TABLE chat_sessions ADD COLUMN title TEXT")


def _snapshot_record_from_row(row: sqlite3.Row) -> SnapshotRecord:
    return SnapshotRecord(
        id=int(row["id"]),
        created_at=datetime.fromisoformat(row["created_at"]),
        source=str(row["source"]),
        reason=row["reason"],
        parent_snapshot_id=row["parent_snapshot_id"],
    )


def _workspace_envelope_from_row(conn: sqlite3.Connection, row: sqlite3.Row) -> WorkspaceEnvelope:
    workspace = workspace_document_from_snapshot_row(conn, row)
    return WorkspaceEnvelope(snapshot=_snapshot_record_from_row(row), workspace=workspace)
