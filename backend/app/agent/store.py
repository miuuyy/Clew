from __future__ import annotations

import json

from app.models.domain import ChatMessage, utc_now
from app.services.repository import GraphRepository


class AgentStore:
    """Durable Codex bindings and replayable UI events, separate from graph snapshots."""

    def __init__(self, repository: GraphRepository):
        self.repository = repository
        with repository._connect() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS agent_sessions (
                    session_id TEXT PRIMARY KEY, thread_id TEXT, run_id TEXT,
                    turn_id TEXT, status TEXT NOT NULL DEFAULT 'idle', error TEXT,
                    client_message_id TEXT
                );
                CREATE TABLE IF NOT EXISTS agent_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
                    run_id TEXT NOT NULL, payload_json TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_agent_events_session ON agent_events(session_id, id);
                CREATE TABLE IF NOT EXISTS agent_tool_results (
                    call_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL,
                    arguments_json TEXT NOT NULL, result_json TEXT NOT NULL
                );
            """)

    def recover_interrupted(self) -> None:
        with self.repository._connect() as conn:
            interrupted = conn.execute("SELECT session_id FROM agent_sessions WHERE status IN ('starting', 'running', 'waiting')").fetchall()
            conn.execute("UPDATE agent_sessions SET status='interrupted', turn_id=NULL, error='The backend restarted. Continue this conversation to resume Codex.' WHERE status IN ('starting', 'running', 'waiting')")
            for session in interrupted:
                rows = conn.execute("SELECT message_id, payload_json FROM chat_messages WHERE session_id=?", (session["session_id"],)).fetchall()
                for row in rows:
                    message = json.loads(row["payload_json"])
                    if message.get("agent_status") == "streaming":
                        message["agent_status"] = "interrupted"
                    for field in ("question", "inline_quiz"):
                        if message.get(field) and message[field].get("status") == "pending":
                            message[field]["status"] = "interrupted"
                    if message.get("activity") and message["activity"].get("status") == "running":
                        message["activity"]["status"] = "failed"
                    conn.execute("UPDATE chat_messages SET payload_json=? WHERE message_id=?", (json.dumps(message), row["message_id"]))

    def delete_session(self, session_id: str) -> None:
        with self.repository._connect() as conn:
            conn.execute("DELETE FROM agent_events WHERE session_id=?", (session_id,))
            conn.execute("DELETE FROM agent_sessions WHERE session_id=?", (session_id,))

    def binding(self, session_id: str) -> dict:
        with self.repository._connect() as conn:
            row = conn.execute("SELECT * FROM agent_sessions WHERE session_id=?", (session_id,)).fetchone()
        return dict(row) if row else {"session_id": session_id, "thread_id": None, "status": "idle", "run_id": None, "turn_id": None}

    def begin(self, session_id: str, run_id: str, client_message_id: str) -> None:
        with self.repository._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM agent_sessions WHERE session_id=?", (session_id,)).fetchone()
            if row and row["status"] in {"starting", "running", "waiting"}:
                raise ValueError("This conversation already has an active turn. Stop it or answer its question first.")
            conn.execute("""INSERT INTO agent_sessions (session_id, run_id, status, client_message_id)
                VALUES (?, ?, 'starting', ?) ON CONFLICT(session_id) DO UPDATE SET
                run_id=excluded.run_id, status='starting', turn_id=NULL, error=NULL,
                client_message_id=excluded.client_message_id""", (session_id, run_id, client_message_id))

    def bind_thread(self, session_id: str, thread_id: str) -> None:
        with self.repository._connect() as conn:
            conn.execute("UPDATE agent_sessions SET thread_id=? WHERE session_id=?", (thread_id, session_id))

    def state(self, session_id: str, run_id: str, status: str, *, turn_id: str | None = None, error: str | None = None) -> None:
        with self.repository._connect() as conn:
            conn.execute("UPDATE agent_sessions SET status=?, turn_id=?, error=? WHERE session_id=? AND run_id=?", (status, turn_id, error, session_id, run_id))

    def emit(self, session_id: str, run_id: str, event: dict) -> dict:
        with self.repository._connect() as conn:
            cursor = conn.execute("INSERT INTO agent_events (session_id, run_id, payload_json) VALUES (?, ?, ?)", (session_id, run_id, json.dumps(event, ensure_ascii=False)))
            event_id = int(cursor.lastrowid)
        return {**event, "event_id": event_id, "session_id": session_id, "run_id": run_id}

    def events(self, session_id: str, after: int) -> list[dict]:
        with self.repository._connect() as conn:
            rows = conn.execute("SELECT * FROM agent_events WHERE session_id=? AND id>? ORDER BY id LIMIT 256", (session_id, after)).fetchall()
        return [{**json.loads(row["payload_json"]), "event_id": row["id"], "session_id": session_id, "run_id": row["run_id"]} for row in rows]

    def last_event_id(self, session_id: str) -> int:
        with self.repository._connect() as conn:
            row = conn.execute("SELECT MAX(id) FROM agent_events WHERE session_id=?", (session_id,)).fetchone()
        return int(row[0] or 0)

    def thread_payload(self, graph_id: str, session_id: str | None = None) -> dict:
        thread = self.repository.chat_thread(graph_id, session_id)
        binding = self.binding(thread.session_id)
        return {**thread.model_dump(mode="json"), "codex_thread_id": binding["thread_id"],
                "run_id": binding.get("run_id"),
                "active_turn_id": binding.get("turn_id"), "agent_status": binding["status"],
                "agent_error": binding.get("error"), "last_event_id": self.last_event_id(thread.session_id)}

    def put_message(self, graph_id: str, session_id: str, message: ChatMessage) -> None:
        # Streaming updates touch one row; do not reload and parse the entire chat per delta.
        with self.repository._connect() as conn:
            self.repository._resolve_session(conn, graph_id, session_id)
            cursor = conn.execute("""INSERT INTO chat_messages
                (message_id, session_id, graph_id, created_at, role, payload_json)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(message_id) DO UPDATE SET payload_json=excluded.payload_json
                WHERE chat_messages.session_id=excluded.session_id""",
                (message.id, session_id, graph_id, message.created_at.isoformat(), message.role, message.model_dump_json()))
            if cursor.rowcount != 1:
                raise ValueError("Message belongs to another conversation.")
            conn.execute("UPDATE chat_sessions SET updated_at=? WHERE session_id=?", (utc_now().isoformat(), session_id))

    def tool_result(self, call_id: str, thread_id: str, arguments: str) -> dict | None:
        with self.repository._connect() as conn:
            row = conn.execute("SELECT * FROM agent_tool_results WHERE call_id=?", (call_id,)).fetchone()
        if row is None:
            return None
        if row["thread_id"] != thread_id or row["arguments_json"] != arguments:
            raise ValueError("Conflicting tool call id.")
        return json.loads(row["result_json"])

    def save_tool_result(self, call_id: str, thread_id: str, arguments: str, result: dict) -> None:
        with self.repository._connect() as conn:
            conn.execute("INSERT INTO agent_tool_results VALUES (?, ?, ?, ?)", (call_id, thread_id, arguments, json.dumps(result, ensure_ascii=False)))
