from __future__ import annotations

from hashlib import sha1
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import (
    ensure_debug_logs_enabled,
    get_assessment_service,
    get_agent_runtime,
    get_debug_logs,
    get_normalizer,
    get_quiz_service,
    get_repository,
)
from app.api.route_helpers import (
    local_user as _local_user,
    local_workspace_surface as _local_workspace_surface,
    normalize_resource_url as _normalize_resource_url,
    resource_label_from_url as _resource_label_from_url,
    workspace_config_payload as _workspace_config_payload,
)
from app.core.config import Settings, get_settings
from app.models.api import GraphExportRequest, GraphImportRequest, GraphLayoutPositionRequest, RenameGraphRequest, TopicArtifactInput, TopicResourceInput, UpdateGraphLayoutRequest
from app.models.domain import Artifact, CreateGraphRequest, GraphProposalEnvelope, QuizStartRequest, QuizStartResponse, QuizSubmitRequest, QuizSubmitResponse, ResourceLink, UpdateWorkspaceConfigRequest
from app.services.debug_log_service import DebugClientLogRequest, get_debug_log_service
from app.services.proposal_normalizer import ProposalNormalizer
from app.services.repository import GraphRepository, ProposalConflictError
from app.agent.transport import CodexError
from app.agent.tools import public_quiz

if TYPE_CHECKING:
    from app.services.quiz_service import QuizService

router = APIRouter()


@router.get("/healthz")
def healthz(settings: Settings = Depends(get_settings)) -> dict:
    return {
        "ok": True,
        "app": settings.app_name,
        "agent_backend": "codex",
    }


@router.get("/api/v1/meta/protocol")
def protocol(settings: Settings = Depends(get_settings)) -> dict:
    return {
        "workspace_shape": "many isolated graphs + shared config",
        "topic_states": ["not_started", "learning", "shaky", "solid", "mastered", "needs_review"],
        "edge_relations": ["requires", "supports", "bridges", "extends", "reviews"],
        "proposal_contract": "/contracts/graph_patch.schema.json",
        "agent_backend": "codex",
        "native_tools_contract": "/contracts/clew_tools.schema.json",
        "guarantees": [
            "topic-first graph",
            "proposal before mutation",
            "snapshot after apply",
            "rollback available",
        ],
    }


@router.get("/api/v1/workspace/current")
def current_workspace(
    repository: GraphRepository = Depends(get_repository),
    settings: Settings = Depends(get_settings),
) -> dict:
    envelope = repository.current()
    return _workspace_config_payload(envelope, settings)


@router.get("/api/v1/workspace/surface")
def workspace_surface(repository: GraphRepository = Depends(get_repository)) -> dict:
    return _local_workspace_surface(repository)


@router.get("/api/v1/auth/session")
def auth_session(
    settings: Settings = Depends(get_settings),
    repository: GraphRepository = Depends(get_repository),
) -> dict:
    return {
        "authenticated": True,
        "user": _local_user(settings),
        "workspace_surface": _local_workspace_surface(repository),
    }


@router.get("/api/v1/debug/logs")
def debug_logs_snapshot(
    _: None = Depends(ensure_debug_logs_enabled),
    debug_logs=Depends(get_debug_logs),
) -> dict:
    return debug_logs.snapshot().model_dump(mode="json")


@router.post("/api/v1/debug/logs/client")
def debug_logs_client_ingest(
    request: DebugClientLogRequest,
    _: None = Depends(ensure_debug_logs_enabled),
    debug_logs=Depends(get_debug_logs),
) -> dict:
    entry = debug_logs.ingest_client_entry(request)
    return {"ok": True, "entry": entry.model_dump(mode="json")}


@router.get("/api/v1/workspace/graphs")
def workspace_graphs(repository: GraphRepository = Depends(get_repository)) -> dict:
    return {
        "items": [summary.model_dump(mode="json") for summary in repository.graph_summaries()],
    }


@router.post("/api/v1/workspace/graphs")
def create_workspace_graph(request: CreateGraphRequest, repository: GraphRepository = Depends(get_repository)) -> dict:
    try:
        workspace = repository.create_graph(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _workspace_config_payload(workspace, get_settings())


@router.delete("/api/v1/workspace/graphs/{graph_id}")
async def delete_workspace_graph(graph_id: str, repository: GraphRepository = Depends(get_repository), runtime=Depends(get_agent_runtime)) -> dict:
    for run in list(runtime.runs.values()):
        if run.graph_id == graph_id and not run.done.done():
            await runtime.interrupt_run(run)
    try:
        workspace = repository.delete_graph(graph_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _workspace_config_payload(workspace, get_settings())


@router.post("/api/v1/workspace/graphs/{graph_id}/rename")
def rename_workspace_graph(
    graph_id: str,
    request: RenameGraphRequest,
    repository: GraphRepository = Depends(get_repository),
) -> dict:
    try:
        workspace = repository.rename_graph(graph_id, request.title)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _workspace_config_payload(workspace, get_settings())


@router.post("/api/v1/workspace/graphs/{graph_id}/layout")
def update_workspace_graph_layout(
    graph_id: str,
    request: UpdateGraphLayoutRequest,
    repository: GraphRepository = Depends(get_repository),
) -> dict:
    try:
        workspace = repository.update_graph_layout(
            graph_id,
            {topic_id: position.model_dump(mode="json") for topic_id, position in request.positions.items()},
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _workspace_config_payload(workspace, get_settings())


@router.post("/api/v1/workspace/graphs/{graph_id}/topics/{topic_id}/resources")
def append_topic_resource(
    graph_id: str,
    topic_id: str,
    body: TopicResourceInput,
    repository: GraphRepository = Depends(get_repository),
    settings: Settings = Depends(get_settings),
) -> dict:
    normalized_url = _normalize_resource_url(body.url)
    if not normalized_url:
        raise HTTPException(status_code=400, detail="resource url is required")
    resource = ResourceLink(
        id=f"resource-{sha1(normalized_url.encode('utf-8')).hexdigest()[:12]}",
        label=_resource_label_from_url(normalized_url),
        url=normalized_url,
        kind="link",
    )
    try:
        workspace = repository.append_topic_resource(graph_id, topic_id, resource)
    except ValueError as exc:
        message = str(exc)
        status_code = 404 if "not found" in message else 400
        raise HTTPException(status_code=status_code, detail=message) from exc
    return _workspace_config_payload(workspace, settings)


@router.post("/api/v1/workspace/graphs/{graph_id}/topics/{topic_id}/artifacts")
def append_topic_artifact(
    graph_id: str,
    topic_id: str,
    body: TopicArtifactInput,
    repository: GraphRepository = Depends(get_repository),
    settings: Settings = Depends(get_settings),
) -> dict:
    normalized_title = body.title.strip()
    normalized_body = body.body.strip()
    if not normalized_title:
        raise HTTPException(status_code=400, detail="artifact title is required")
    if not normalized_body:
        raise HTTPException(status_code=400, detail="artifact body is required")
    artifact_id_source = f"{graph_id}:{topic_id}:{normalized_title}:{normalized_body}"
    artifact = Artifact(
        id=f"artifact-{sha1(artifact_id_source.encode('utf-8')).hexdigest()[:12]}",
        title=normalized_title,
        kind="note",
        body=normalized_body,
    )
    try:
        workspace = repository.append_topic_artifact(graph_id, topic_id, artifact)
    except ValueError as exc:
        message = str(exc)
        status_code = 404 if "not found" in message else 400
        raise HTTPException(status_code=status_code, detail=message) from exc
    return _workspace_config_payload(workspace, settings)


@router.post("/api/v1/workspace/graphs/{graph_id}/export")
def export_workspace_graph(
    graph_id: str,
    request: GraphExportRequest,
    repository: GraphRepository = Depends(get_repository),
) -> dict:
    try:
        if request.format == "mapmind_obsidian_export":
            package = repository.export_graph_to_obsidian(
                graph_id,
                title=request.title,
                include_progress=request.include_progress,
                options=request.obsidian,
            )
        else:
            package = repository.export_graph_package(
                graph_id,
                title=request.title,
                include_progress=request.include_progress,
            )
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return package.model_dump(mode="json")


@router.post("/api/v1/workspace/graphs/import")
def import_workspace_graph(
    request: GraphImportRequest,
    repository: GraphRepository = Depends(get_repository),
    settings: Settings = Depends(get_settings),
) -> dict:
    try:
        workspace = repository.import_graph_package(
            request.package,
            title=request.title,
            include_progress=request.include_progress,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _workspace_config_payload(workspace, settings)


@router.post("/api/v1/workspace/config")
def update_workspace_config(
    request: UpdateWorkspaceConfigRequest,
    repository: GraphRepository = Depends(get_repository),
    settings: Settings = Depends(get_settings),
) -> dict:
    try:
        workspace = repository.update_workspace_config(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _workspace_config_payload(workspace, settings)


@router.get("/api/v1/graphs/{graph_id}")
def graph_by_id(graph_id: str, repository: GraphRepository = Depends(get_repository)) -> dict:
    try:
        graph = repository.graph(graph_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"graph {graph_id} not found") from exc
    return graph.model_dump(mode="json")


@router.get("/api/v1/graphs/{graph_id}/assessment")
def graph_assessment(
    graph_id: str,
    repository: GraphRepository = Depends(get_repository),
    assessment_service: AssessmentService = Depends(get_assessment_service),
) -> dict:
    try:
        graph = repository.graph(graph_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"graph {graph_id} not found") from exc
    return assessment_service.assess_graph(graph).model_dump(mode="json")


@router.get("/api/v1/graph/current")
def current_graph(repository: GraphRepository = Depends(get_repository)) -> dict:
    envelope = repository.current()
    graph_id = envelope.workspace.active_graph_id or (envelope.workspace.graphs[0].graph_id if envelope.workspace.graphs else None)
    if graph_id is None:
        raise HTTPException(status_code=404, detail="no graphs found")
    graph = repository.graph(graph_id)
    return graph.model_dump(mode="json")


@router.get("/api/v1/graph/snapshots")
def graph_snapshots(repository: GraphRepository = Depends(get_repository)) -> dict:
    return {
        "items": [record.model_dump(mode="json") for record in repository.list_snapshots()],
    }


@router.post("/api/v1/graphs/{graph_id}/topics/{topic_id}/quiz/start")
async def start_topic_quiz(
    graph_id: str,
    topic_id: str,
    request: QuizStartRequest,
    repository: GraphRepository = Depends(get_repository),
    runtime=Depends(get_agent_runtime),
) -> dict:
    try:
        graph = repository.graph(graph_id)
        topic = next((item for item in graph.topics if item.id == topic_id), None)
        if topic is None:
            raise KeyError(topic_id)
        session = repository.latest_quiz_session_for_topic(graph_id, topic_id)
        if session is None:
            session = await runtime.generate_closure_quiz(
                graph_id, topic_id, request.question_count or topic.quiz_policy.question_count, request.model,
            )
        return QuizStartResponse(session=public_quiz(session)).model_dump(mode="json")
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Graph or topic not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except CodexError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/api/v1/graphs/{graph_id}/topics/{topic_id}/quiz/submit")
def submit_topic_quiz(
    graph_id: str,
    topic_id: str,
    request: QuizSubmitRequest,
    repository: GraphRepository = Depends(get_repository),
    quiz_service: "QuizService" = Depends(get_quiz_service),
    settings: Settings = Depends(get_settings),
) -> dict:
    try:
        graph = repository.graph(graph_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"graph {graph_id} not found") from exc
    try:
        session = repository.quiz_session(request.session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"quiz session {request.session_id} not found") from exc
    if session.graph_id != graph_id or session.topic_id != topic_id:
        raise HTTPException(status_code=400, detail="quiz session does not match graph/topic route")

    answers = {answer.question_id: answer.choice_index for answer in request.answers}
    attempt, _, awarded_state, reviews = quiz_service.grade_session(graph, session, answers)
    workspace = repository.record_quiz_attempt(graph_id, attempt, awarded_state)
    updated_graph = next(item for item in workspace.workspace.graphs if item.graph_id == graph_id)
    closure_status = quiz_service.build_closure_status(updated_graph, topic_id)
    repository.delete_quiz_session(request.session_id)
    repository.append_event(
        "graph.quiz.submitted",
        {
            "graph_id": graph_id,
            "topic_id": topic_id,
            "session_id": request.session_id,
            "score": attempt.score,
            "passed": attempt.passed,
            "closure_awarded": attempt.closure_awarded,
        },
    )
    return QuizSubmitResponse(
        attempt=attempt,
        closure_status=closure_status,
        awarded_state=awarded_state,
        reviews=reviews,
        workspace=workspace,
    ).model_dump(mode="json") | {"workspace": _workspace_config_payload(workspace, settings)}


@router.post("/api/v1/graphs/{graph_id}/topics/{topic_id}/mark-finished")
def mark_topic_finished(
    graph_id: str,
    topic_id: str,
    repository: GraphRepository = Depends(get_repository),
    quiz_service: "QuizService" = Depends(get_quiz_service),
    settings: Settings = Depends(get_settings),
) -> dict:
    try:
        workspace = repository.mark_topic_finished(graph_id, topic_id)
    except ValueError as exc:
        message = str(exc)
        raise HTTPException(status_code=404 if "not found" in message else 400, detail=message) from exc

    existing_session = repository.latest_quiz_session_for_topic(graph_id, topic_id)
    if existing_session is not None:
        repository.delete_quiz_session(existing_session.session_id)

    updated_graph = next(item for item in workspace.workspace.graphs if item.graph_id == graph_id)
    closure_status = quiz_service.build_closure_status(updated_graph, topic_id)
    attempt = next(item for item in updated_graph.quiz_attempts if item.topic_id == topic_id)
    repository.append_event(
        "graph.topic.mark_finished",
        {
            "graph_id": graph_id,
            "topic_id": topic_id,
            "score": attempt.score,
            "passed": attempt.passed,
            "closure_awarded": attempt.closure_awarded,
        },
    )
    return QuizSubmitResponse(
        attempt=attempt,
        closure_status=closure_status,
        awarded_state="solid",
        reviews=[],
        workspace=workspace,
    ).model_dump(mode="json") | {"workspace": _workspace_config_payload(workspace, settings)}


@router.post("/api/v1/graphs/{graph_id}/normalize")
def normalize_graph_proposal(
    graph_id: str,
    envelope: GraphProposalEnvelope,
    repository: GraphRepository = Depends(get_repository),
    normalizer: ProposalNormalizer = Depends(get_normalizer),
) -> dict:
    if envelope.graph_id != graph_id:
        raise HTTPException(status_code=400, detail="graph_id in route and payload must match")
    try:
        graph = repository.graph(graph_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"graph {graph_id} not found") from exc
    plan = normalizer.normalize(envelope, graph=graph)
    return plan.model_dump(mode="json")


@router.post("/api/v1/graphs/{graph_id}/apply")
def apply_graph_proposal(
    graph_id: str,
    envelope: GraphProposalEnvelope,
    repository: GraphRepository = Depends(get_repository),
    normalizer: ProposalNormalizer = Depends(get_normalizer),
) -> dict:
    if envelope.graph_id != graph_id:
        raise HTTPException(status_code=400, detail="graph_id in route and payload must match")
    try:
        graph = repository.graph(graph_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"graph {graph_id} not found") from exc
    plan = normalizer.normalize(envelope, graph=graph)
    if not plan.validation.ok:
        raise HTTPException(status_code=400, detail={"errors": plan.validation.errors, "warnings": plan.validation.warnings})
    try:
        applied = repository.apply_proposal(plan.normalized_proposal)
    except ProposalConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _workspace_config_payload(applied, get_settings())


@router.post("/api/v1/graph/rollback/{snapshot_id}")
async def rollback_graph(snapshot_id: int, repository: GraphRepository = Depends(get_repository), runtime=Depends(get_agent_runtime)) -> dict:
    for run in list(runtime.runs.values()):
        if not run.done.done():
            await runtime.interrupt_run(run)
    try:
        envelope = repository.rollback_to(snapshot_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"snapshot {snapshot_id} not found") from exc
    return _workspace_config_payload(envelope, get_settings())


from app.api.chat_routes import router as chat_router
from app.api.codex_routes import router as codex_router

router.include_router(chat_router)
router.include_router(codex_router)
