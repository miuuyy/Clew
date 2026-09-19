from __future__ import annotations

import json
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import get_agent_runtime, get_repository
from app.agent.transport import CodexError
from app.models.domain import GraphChatRequest
from app.services.repository import ChatSessionDeletionError, ChatSessionNotFoundError, GraphRepository

router = APIRouter()


class CreateSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    topic_id: str | None = None
    title: str | None = None


class AnswerRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str
    interaction_id: str
    answer: str | None = Field(default=None, max_length=12000)
    choice_index: int | None = Field(default=None, ge=0)


class SessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str


def resolve_thread(runtime, graph_id: str, session_id: str | None = None) -> dict:
    try:
        runtime.repository.graph(graph_id)
        return runtime.store.thread_payload(graph_id, session_id)
    except (KeyError, ChatSessionNotFoundError) as exc:
        raise HTTPException(status_code=404, detail="Graph or chat session not found") from exc


def event_stream(runtime, session_id: str, run_id: str, after: int = 0):
    async def stream():
        async for event in runtime.events(session_id, run_id, after):
            yield json.dumps(event, ensure_ascii=False) + "\n"
    return StreamingResponse(stream(), media_type="application/x-ndjson", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/api/v1/graphs/{graph_id}/chat")
async def graph_chat_thread(graph_id: str, session_id: str | None = None, runtime=Depends(get_agent_runtime)) -> dict:
    return resolve_thread(runtime, graph_id, session_id)


@router.get("/api/v1/graphs/{graph_id}/chat/sessions")
def list_chat_sessions(graph_id: str, repository: GraphRepository = Depends(get_repository)) -> list[dict]:
    try:
        repository.graph(graph_id)
        return [s.model_dump(mode="json") for s in repository.list_chat_sessions(graph_id)]
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Graph not found") from exc


@router.post("/api/v1/graphs/{graph_id}/chat/sessions")
def create_chat_session(graph_id: str, body: CreateSessionRequest, repository: GraphRepository = Depends(get_repository)) -> dict:
    try:
        repository.graph(graph_id)
        return repository.create_chat_session(graph_id, topic_id=body.topic_id, title=body.title).model_dump(mode="json")
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Graph not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/api/v1/graphs/{graph_id}/chat/sessions/{session_id}")
async def delete_chat_session(graph_id: str, session_id: str, runtime=Depends(get_agent_runtime)) -> dict:
    resolve_thread(runtime, graph_id, session_id)
    try:
        # Repository prohibits deleting the graph's default session.
        session = runtime.repository.chat_thread(graph_id, session_id)
        if session.topic_id is None:
            raise ChatSessionDeletionError("The default graph conversation cannot be deleted")
        await runtime.interrupt(graph_id, session_id)
        runtime.repository.delete_chat_session(graph_id, session_id)
        runtime.store.delete_session(session_id)
    except ChatSessionDeletionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except CodexError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"ok": True}


@router.post("/api/v1/graphs/{graph_id}/chat/stream")
async def stream_chat(graph_id: str, body: GraphChatRequest, runtime=Depends(get_agent_runtime)):
    resolve_thread(runtime, graph_id, body.session_id)
    try:
        session_id, run_id = await runtime.start_chat(graph_id, body)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except CodexError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return event_stream(runtime, session_id, run_id)


@router.get("/api/v1/graphs/{graph_id}/chat/events")
async def chat_events(graph_id: str, session_id: str, after: int = Query(default=0, ge=0), runtime=Depends(get_agent_runtime)):
    resolve_thread(runtime, graph_id, session_id)
    binding = runtime.store.binding(session_id)
    return event_stream(runtime, session_id, binding.get("run_id") or "", after)


@router.post("/api/v1/graphs/{graph_id}/chat/answer")
async def answer_question(graph_id: str, body: AnswerRequest, runtime=Depends(get_agent_runtime)) -> dict:
    resolve_thread(runtime, graph_id, body.session_id)
    try:
        return await runtime.answer(graph_id, body.session_id, body.interaction_id, answer=body.answer, choice_index=body.choice_index)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/api/v1/graphs/{graph_id}/chat/interrupt")
async def interrupt_chat(graph_id: str, body: SessionRequest, runtime=Depends(get_agent_runtime)) -> dict:
    resolve_thread(runtime, graph_id, body.session_id)
    try:
        await runtime.interrupt(graph_id, body.session_id)
    except CodexError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return resolve_thread(runtime, graph_id, body.session_id)
