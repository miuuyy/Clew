from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import urlparse

from app.core.config import Settings
from app.services.repository import GraphRepository


def workspace_config_payload(envelope, settings: Settings) -> dict:
    return envelope.model_dump(mode="json")


def local_workspace_surface(repository: GraphRepository) -> dict:
    workspace = repository.current().workspace
    graph_count = len(workspace.graphs)
    demo_graph_count = sum(1 for graph in workspace.graphs if bool(graph.metadata.get("demo")))
    personal_graph_count = max(0, graph_count - demo_graph_count)
    active_graph_id = workspace.active_graph_id or (workspace.graphs[0].graph_id if workspace.graphs else None)
    return {
        "onboarding_state": "active_workspace" if graph_count > 0 else "needs_first_graph",
        "active_graph_id": active_graph_id,
        "graph_count": graph_count,
        "personal_graph_count": personal_graph_count,
        "demo_graph_count": demo_graph_count,
        "graph_limit": 9999,
        "library_post_count": 0,
        "demo_library_post_id": None,
        "primary_action": "resume_workspace" if graph_count > 0 else "create_graph",
        "recommended_actions": ["resume_workspace"] if graph_count > 0 else ["create_graph"],
        "can_create_graph": True,
        "can_import_from_library": False,
        "grounding_default_enabled": workspace.config.web_search_enabled,
    }


def local_user(settings: Settings) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": "local-user",
        "name": settings.local_user_name,
        "email": settings.local_user_email,
        "avatar_url": None,
        "ui_language": "en",
        "created_at": now,
        "last_login_at": now,
        "active_workspace_id": "default",
    }


def resource_label_from_url(url: str) -> str:
    parsed = urlparse(url.strip())
    host = parsed.netloc.replace("www.", "") if parsed.netloc else ""
    path = parsed.path.rstrip("/")
    tail = path.split("/")[-1] if path else ""
    if host and tail:
        return f"{host}/{tail}"
    if host:
        return host
    return url.strip()


def normalize_resource_url(raw: str) -> str:
    value = raw.strip()
    if not value:
        return ""
    parsed = urlparse(value)
    if not parsed.scheme:
        value = f"https://{value}"
        parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"}:
        return ""
    if not parsed.netloc:
        return ""
    return value
