"""MCP stdio server for Clew.

Wires four read-only tools over the user's local Clew workspace so that
any MCP client (Claude Desktop, Claude Code, Cursor, ...) can see their
graphs, current learning progress, and note contents.

The server loads the workspace from the same SQLite database the Clew
backend uses (``knowledge_graph.sqlite3``). The database path is resolved
from the existing backend settings (``KG_DB_PATH`` / ``DB_PATH``), so no
extra configuration is required when running alongside the regular backend.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Callable

from mcp import types
from mcp.server import Server
from mcp.server.stdio import stdio_server

from app.core.config import get_settings
from app.services.repository import GraphRepository

from . import tools as tool_impls


logger = logging.getLogger("clew.study_assist")
SERVER_NAME = "Clew Study Assist"


SERVER_INSTRUCTIONS = """\
Clew holds the user's learning graphs. Nodes are study topics with a \
progress state (not_started, learning, shaky, needs_review, solid, \
mastered). Edges describe relationships between topics, with the \
``requires`` relation representing prerequisites. The user can have \
several graphs (for example one per subject), and exactly one of them is \
active at a time.

Call ``get_current_learning_context`` before answering questions that \
touch what the user is studying so that your reply reflects their \
in-progress topics and any topics blocked by open prerequisites. Use \
``search_notes`` to find a node by keyword, then ``get_node`` for the \
full description, resources, and neighbors. Call ``list_graphs`` only \
when the user mentions a graph you have not seen yet.\
"""


def _tool_schema(properties: dict[str, dict[str, Any]], required: list[str] | None = None) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": required or [],
        "additionalProperties": False,
    }


TOOLS: list[types.Tool] = [
    types.Tool(
        name="list_graphs",
        description=(
            "List every learning graph the user has in Clew with light "
            "progress stats (total topics, closed topics, in-progress "
            "topics). Use this when the user mentions a subject or graph "
            "you have not seen yet, or when you need to pick a graph_id "
            "for the other tools."
        ),
        inputSchema=_tool_schema({}),
    ),
    types.Tool(
        name="get_current_learning_context",
        description=(
            "Summarize what the user is currently working on. The user "
            "typically has several graphs (for example math, projects, "
            "languages). When graph_id is omitted, returns a per-graph "
            "summary across the active graph AND every other graph with "
            "learning activity — use this shape whenever the user asks "
            "an open question like 'what am I learning', so you see the "
            "full picture instead of only one subject. When graph_id is "
            "given, returns detail for that one graph. Call this tool "
            "before answering any question that touches the user's study "
            "progress so your reply reflects their actual graph state."
        ),
        inputSchema=_tool_schema(
            {
                "graph_id": {
                    "type": "string",
                    "description": (
                        "Specific graph to drill into. Omit to get a "
                        "per-graph summary across all graphs with activity."
                    ),
                },
            }
        ),
    ),
    types.Tool(
        name="get_node",
        description=(
            "Return the full content of one topic (node): title, "
            "description, progress state, resources, artifacts, neighbors "
            "across every edge relation, and the list of prerequisites "
            "that are still blocking closure. Use this after you know a "
            "specific node_id (for example from search_notes or "
            "get_current_learning_context)."
        ),
        inputSchema=_tool_schema(
            {
                "graph_id": {"type": "string", "description": "Graph that contains the node."},
                "node_id": {
                    "type": "string",
                    "description": "Node id or slug. Both are accepted.",
                },
            },
            required=["graph_id", "node_id"],
        ),
    ),
    types.Tool(
        name="search_notes",
        description=(
            "Search topics by keyword across titles, slugs, and "
            "descriptions. If graph_id is omitted, searches every graph "
            "the user has. Use this when the user mentions a concept by "
            "name and you need to find the matching node(s) before "
            "calling get_node."
        ),
        inputSchema=_tool_schema(
            {
                "query": {"type": "string", "description": "Keyword or phrase to search for."},
                "graph_id": {
                    "type": "string",
                    "description": "Restrict search to one graph. Omit to search all graphs.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of results to return (default 12).",
                    "minimum": 1,
                    "maximum": 50,
                },
            },
            required=["query"],
        ),
    ),
]


def _resolve_db_path() -> Path:
    explicit = os.environ.get("CLEW_DB_PATH") or os.environ.get("KG_DB_PATH")
    if explicit:
        return Path(explicit).expanduser().resolve()
    return get_settings().db_path


def _success_result(payload: dict[str, Any]) -> types.CallToolResult:
    text = json.dumps(payload, ensure_ascii=False, indent=2, default=str)
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=text)],
        structuredContent=payload,
        isError=False,
    )


def _error_result(message: str, *, payload: dict[str, Any] | None = None) -> types.CallToolResult:
    body = payload or {"error": message}
    text = json.dumps(body, ensure_ascii=False, indent=2, default=str)
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=text)],
        structuredContent=body,
        isError=True,
    )


def build_server(repository: GraphRepository) -> Server:
    server: Server = Server(SERVER_NAME, instructions=SERVER_INSTRUCTIONS)

    handlers: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
        "list_graphs": lambda _args: tool_impls.list_graphs(repository.current().workspace),
        "get_current_learning_context": lambda args: tool_impls.get_current_context(
            repository.current().workspace,
            graph_id=args.get("graph_id"),
        ),
        "get_node": lambda args: tool_impls.get_node(
            repository.current().workspace,
            graph_id=args["graph_id"],
            node_id=args["node_id"],
        ),
        "search_notes": lambda args: tool_impls.search_nodes(
            repository.current().workspace,
            query=args["query"],
            graph_id=args.get("graph_id"),
            limit=int(args.get("limit") or 12),
        ),
    }

    @server.list_tools()
    async def _list_tools() -> list[types.Tool]:
        return TOOLS

    @server.call_tool()
    async def _call_tool(name: str, arguments: dict[str, Any] | None) -> types.CallToolResult:
        handler = handlers.get(name)
        if handler is None:
            return _error_result(f"unknown tool: {name}")
        args = arguments or {}
        try:
            payload = handler(args)
            return _success_result(payload)
        except ValueError as exc:
            return _error_result(str(exc))
        except KeyError as exc:
            return _error_result(f"missing key: {exc}")
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("mcp tool %s failed", name)
            return _error_result(
                "internal error while executing the Clew Study Assist MCP tool",
                payload={"error": f"internal error: {exc}"},
            )

    return server


async def run_stdio() -> None:
    db_path = _resolve_db_path()
    if not db_path.exists():
        raise FileNotFoundError(
            "Clew database not found. Run Clew once to create it or set "
            f"CLEW_DB_PATH/KG_DB_PATH explicitly. Expected path: {db_path}"
        )
    logger.info("clew-study-assist starting with db=%s", db_path)
    repository = GraphRepository(db_path)
    server = build_server(repository)
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            server.create_initialization_options(),
        )
