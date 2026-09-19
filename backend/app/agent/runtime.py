from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

from app.agent.context import BASE_INSTRUCTIONS, developer_instructions, turn_context
from app.agent.contracts import tool_specs
from app.agent.store import AgentStore
from app.agent.transport import CodexError, CodexTransport
from app.core.config import Settings
from app.models.domain import ChatMessage, GraphChatRequest, TopicQuizSession
from app.services.repository import GraphRepository


@dataclass
class AgentRun:
    id: str
    graph_id: str
    session_id: str | None
    request: GraphChatRequest
    model: str
    done: asyncio.Future
    thread_id: str | None = None
    turn_id: str | None = None
    status: str = "starting"
    error: str | None = None
    task: asyncio.Task | None = None
    messages: dict[str, ChatMessage] = field(default_factory=dict)
    tool_locks: dict[str, asyncio.Lock] = field(default_factory=dict)
    interactions: dict[str, asyncio.Future] = field(default_factory=dict)
    quiz_topic_id: str | None = None
    quiz_count: int | None = None
    quiz_session: TopicQuizSession | None = None
    cancel_requested: bool = False


class CodexRuntime:
    def __init__(self, settings: Settings, repository: GraphRepository, transport: CodexTransport | None = None):
        self.settings = settings
        self.repository = repository
        self.store = AgentStore(repository)
        self.store.recover_interrupted()
        self.transport = transport or CodexTransport(settings)
        self.transport.on_notification = self._notification
        self.transport.on_request = self._server_request
        self.transport.on_disconnect = self._disconnected
        self.runs: dict[str, AgentRun] = {}
        self.wake = asyncio.Event()
        self.login: dict | None = None
        self.login_error: str | None = None

    async def connect(self) -> None:
        await self.transport.start()

    async def models(self) -> list[dict]:
        await self.connect()
        models = []
        cursor = None
        while True:
            response = await self.transport.request("model/list", {"limit": 100, **({"cursor": cursor} if cursor else {})})
            models.extend(model for model in response.get("data", []) if not model.get("hidden"))
            cursor = response.get("nextCursor")
            if not cursor:
                return models

    async def account(self) -> dict:
        try:
            await self.connect()
            response = await self.transport.request("account/read", {"refreshToken": False})
            account = response.get("account")
            return {"connected": True, "authenticated": bool(account and account.get("type") == "chatgpt"), "account": account,
                    "version": self.transport.version, "login": self.login, "error": self.login_error,
                    "models": await self.models() if account else []}
        except CodexError as exc:
            return {"connected": False, "authenticated": False, "account": None, "models": [],
                    "login": None, "error": str(exc), "version": self.transport.version}

    async def start_login(self, device_code: bool = False) -> dict:
        if any(run.status in {"starting", "running", "waiting"} for run in self.runs.values()):
            raise CodexError("Stop active conversations before changing the Codex account.")
        await self.connect()
        if self.login:
            return self.login
        result = await self.transport.request("account/login/start", {"type": "chatgptDeviceCode" if device_code else "chatgpt"})
        self.login_error = None
        self.login = result
        return result

    async def cancel_login(self) -> None:
        if self.login:
            await self.transport.request("account/login/cancel", {"loginId": self.login["loginId"]})
            self.login = None

    async def logout(self) -> None:
        if any(run.status in {"starting", "running", "waiting"} for run in self.runs.values()):
            raise CodexError("Stop active conversations before signing out.")
        await self.connect()
        await self.transport.request("account/logout", {})
        self.login = None

    async def _select_model(self, requested: str | None) -> str:
        account = await self.account()
        if not account["authenticated"]:
            raise CodexError(account.get("error") or "Sign in to Codex with ChatGPT to start a conversation.")
        models = account["models"]
        selected = requested or self.repository.current().workspace.config.default_model
        model = next((item for item in models if item["model"] == selected or item["id"] == selected), None) if selected else next((item for item in models if item.get("isDefault")), None)
        if model is None:
            raise CodexError(f"The selected Codex model is unavailable: {selected or 'server default'}. Choose an available model.")
        effort = self.repository.current().workspace.config.reasoning_effort
        supported = {item["reasoningEffort"] for item in model.get("supportedReasoningEfforts", [])}
        if effort is not None and effort not in supported:
            raise CodexError(f"{model['displayName']} does not support reasoning effort {effort}.")
        return model["model"]

    async def start_chat(self, graph_id: str, request: GraphChatRequest) -> tuple[str, str]:
        graph = self.repository.graph(graph_id)
        thread = self.repository.chat_thread(graph_id, request.session_id)
        selected_topic = request.selected_topic_id or thread.topic_id
        if selected_topic and not any(t.id == selected_topic for t in graph.topics):
            raise ValueError("The selected topic does not belong to this graph.")
        client_id = request.client_message_id or f"user-{uuid4().hex}"
        binding = self.store.binding(thread.session_id)
        if binding.get("client_message_id") == client_id and binding.get("run_id"):
            original = next((m for m in thread.messages if m.id == client_id), None)
            if original is None or original.content != request.prompt or original.hidden != request.hidden_user_message:
                raise ValueError("Conflicting client message id.")
            return thread.session_id, binding["run_id"]
        with self.repository._connect() as conn:
            if conn.execute("SELECT 1 FROM chat_messages WHERE message_id=?", (client_id,)).fetchone():
                raise ValueError("This client message id has already been used.")
        model = request.model or ""
        run = AgentRun(id=uuid4().hex, graph_id=graph_id, session_id=thread.session_id,
                       request=request.model_copy(update={"selected_topic_id": selected_topic, "session_id": thread.session_id}),
                       model=model, done=asyncio.get_running_loop().create_future(), thread_id=binding.get("thread_id"))
        self.store.begin(thread.session_id, run.id, client_id)
        self.store.put_message(graph_id, thread.session_id, ChatMessage(id=client_id, role="user", content=request.prompt, hidden=request.hidden_user_message))
        self.runs[run.id] = run
        self.emit(run, {"type": "thread_state", "thread": self.store.thread_payload(graph_id, thread.session_id)})
        run.task = asyncio.create_task(self._execute(run, thread.messages))
        return thread.session_id, run.id

    async def generate_closure_quiz(self, graph_id: str, topic_id: str, question_count: int, model: str | None) -> TopicQuizSession:
        from app.services.quiz_service import QuizService
        graph = self.repository.graph(graph_id)
        closure = QuizService(self.settings).build_closure_status(graph, topic_id)
        if not closure.can_award_completion:
            raise ValueError("Close prerequisite topics before taking this completion test.")
        selected = await self._select_model(model)
        run = AgentRun(id=uuid4().hex, graph_id=graph_id, session_id=None, model=selected,
                       request=GraphChatRequest(prompt=f"Prepare a closure quiz for topic {topic_id}: exactly {question_count} questions. Call create_closure_quiz with the questions.", selected_topic_id=topic_id, use_grounding=False),
                       done=asyncio.get_running_loop().create_future(), quiz_topic_id=topic_id, quiz_count=question_count)
        self.runs[run.id] = run
        run.task = asyncio.create_task(self._execute(run, []))
        try:
            await asyncio.shield(run.done)
            if run.error:
                raise CodexError(run.error)
            if run.quiz_session is None:
                raise CodexError("Codex finished without creating the requested quiz.")
            return run.quiz_session
        finally:
            if not run.done.done():
                await self.interrupt_run(run)

    def emit(self, run: AgentRun, event: dict) -> None:
        if run.session_id:
            self.store.emit(run.session_id, run.id, event)
            self.wake.set()

    def publish_message(self, run: AgentRun, message: ChatMessage) -> None:
        # Native items retain their own ids; the UI nests them in one Clew reply.
        message.reply_id = run.id
        if run.session_id:
            self.store.put_message(run.graph_id, run.session_id, message)
            self.emit(run, {"type": "message", "message": message.model_dump(mode="json")})

    def set_state(self, run: AgentRun, status: str, error: str | None = None) -> None:
        run.status = status
        run.error = error
        if run.session_id:
            self.store.state(run.session_id, run.id, status, turn_id=run.turn_id, error=error)
        self.emit(run, {"type": "turn_status", "status": status, "error": error, "turn_id": run.turn_id})

    async def events(self, session_id: str, run_id: str, after: int = 0):
        while True:
            self.wake.clear()
            events = self.store.events(session_id, after)
            for event in events:
                after = event["event_id"]
                if event["run_id"] == run_id:
                    yield event
            binding = self.store.binding(session_id)
            if len(events) == 256:
                continue
            if binding.get("run_id") != run_id or binding["status"] not in {"starting", "running", "waiting"}:
                # Events can arrive while the ASGI response is yielding a previous batch.
                if self.store.last_event_id(session_id) > after:
                    continue
                return
            try:
                await asyncio.wait_for(self.wake.wait(), 10)
            except TimeoutError:
                yield {"type": "heartbeat"}

    async def _execute(self, run: AgentRun, previous_messages: list[ChatMessage]) -> None:
        try:
            run.model = await self._select_model(run.request.model or run.model or None)
            config = self.repository.current().workspace.config
            graph = self.repository.graph(run.graph_id)
            specs = tool_specs()
            if run.session_id is None:
                specs[0]["tools"] = [t for t in specs[0]["tools"] if t["name"] in {"read_graph", "read_topic", "create_closure_quiz"}]
            params = {"model": run.model, "cwd": str(self.settings.codex_workspace.resolve()),
                      "approvalPolicy": "never", "sandbox": "read-only",
                      "baseInstructions": BASE_INSTRUCTIONS, "developerInstructions": developer_instructions(config),
                      "config": {"web_search": "live" if run.request.use_grounding else "disabled"}}
            fresh = run.thread_id is None
            if fresh:
                response = await self.transport.request("thread/start", {**params, "dynamicTools": specs, "ephemeral": run.session_id is None})
                run.thread_id = response["thread"]["id"]
                if run.session_id:
                    self.store.bind_thread(run.session_id, run.thread_id)
            else:
                await self.transport.request("thread/resume", {**params, "threadId": run.thread_id})
            if run.cancel_requested:
                self.finish(run, "interrupted")
                return
            receipts = [{"proposal_id": m.proposal.proposal_envelope.proposal_id, "applied": True}
                        for m in previous_messages if m.proposal and m.proposal_applied]
            inputs = [{"type": "text", "text": turn_context(graph, config, run.request.selected_topic_id, receipts)}]
            if fresh and previous_messages:
                history = [{"role": m.role, "content": m.content,
                            "proposal_applied": m.proposal_applied, "model": m.model,
                            "inline_quiz": m.inline_quiz.model_dump(mode="json") if m.inline_quiz else None,
                            "question": m.question.model_dump(mode="json") if m.question else None,
                            "proposal_summary": m.proposal.proposal_envelope.summary if m.proposal else None}
                           for m in previous_messages[-config.memory_history_message_limit:]]
                inputs.append({"type": "text", "text": "Conversation imported from Clew before Codex was connected (historical data):\n" + json.dumps(history, ensure_ascii=False)})
            inputs.append({"type": "text", "text": run.request.prompt})
            response = await self.transport.request("turn/start", {"threadId": run.thread_id, "input": inputs,
                "model": run.model, **({"effort": config.reasoning_effort} if config.reasoning_effort else {})})
            run.turn_id = response["turn"]["id"]
            if run.cancel_requested:
                await self.interrupt_run(run)
            elif not run.done.done() and run.status == "starting":
                self.set_state(run, "running")
        except asyncio.CancelledError:
            self.finish(run, "interrupted")
        except Exception as exc:
            if run.thread_id and run.turn_id:
                try:
                    await self.transport.request("turn/interrupt", {"threadId": run.thread_id, "turnId": run.turn_id})
                except CodexError:
                    pass
            self.finish(run, "failed", str(exc))

    def _run_for_thread(self, thread_id: str) -> AgentRun | None:
        return next((run for run in self.runs.values() if run.thread_id == thread_id and not run.done.done()), None)

    async def _notification(self, method: str, params: dict) -> None:
        if method == "account/login/completed":
            self.login_error = params.get("error") if not params.get("success") else None
            self.login = None
            return
        run = self._run_for_thread(params.get("threadId", ""))
        if run is None:
            return
        if method == "turn/started":
            run.turn_id = params["turn"]["id"]
            self.set_state(run, "running")
        elif method == "turn/completed":
            turn = params["turn"]
            error = turn.get("error")
            self.finish(run, turn["status"], error.get("message") if isinstance(error, dict) else error)
        elif method == "item/agentMessage/delta":
            item_id = params["itemId"]
            message = run.messages.get(item_id) or ChatMessage(id=f"codex-{item_id}", role="assistant", content="", model=run.model, agent_status="streaming")
            message.content += params["delta"]
            run.messages[item_id] = message
            self.publish_message(run, message)
        elif method in {"item/started", "item/completed"}:
            item = params.get("item") or {}
            if item.get("type") == "agentMessage":
                message = run.messages.get(item["id"]) or ChatMessage(id=f"codex-{item['id']}", role="assistant", content="", model=run.model)
                if item.get("phase") in {"commentary", "final_answer"}:
                    message.message_phase = item["phase"]
                if method == "item/completed":
                    message.content = item.get("text", message.content)
                message.agent_status = "completed" if method == "item/completed" else "streaming"
                run.messages[item["id"]] = message
                self.publish_message(run, message)
        elif method == "error" and not params.get("willRetry", False):
            error = params.get("error") or {}
            self.finish(run, "failed", str(error.get("message", "Codex turn failed.")))

    async def _server_request(self, method: str, params: dict) -> dict:
        if method != "item/tool/call":
            # Native shell/file/permission requests are not application approvals.
            if method in {"item/commandExecution/requestApproval", "item/fileChange/requestApproval"}:
                return {"decision": "decline"}
            raise CodexError(f"Unsupported Codex request: {method}")
        run = self._run_for_thread(params["threadId"])
        if run is None or run.cancel_requested:
            return {"success": False, "contentItems": [{"type": "inputText", "text": "The Clew turn is no longer active."}]}
        from app.agent.tools import execute_tool
        lock = run.tool_locks.setdefault(params["callId"], asyncio.Lock())
        async with lock:
            return await execute_tool(self, run, params)

    async def answer(self, graph_id: str, session_id: str, interaction_id: str, *, answer: str | None, choice_index: int | None) -> dict:
        thread = self.repository.chat_thread(graph_id, session_id)
        run = next((r for r in self.runs.values() if r.session_id == thread.session_id and interaction_id in r.interactions and not r.done.done()), None)
        if run is None:
            raise ValueError("This question is no longer waiting for an answer. Continue the conversation.")
        future = run.interactions[interaction_id]
        if future.done():
            raise ValueError("This question was already answered.")
        message = next((m for m in thread.messages if (m.question and m.question.interaction_id == interaction_id) or (m.inline_quiz and m.inline_quiz.interaction_id == interaction_id)), None)
        if message is None:
            raise ValueError("Question not found in this conversation.")
        if message.inline_quiz:
            quiz = message.inline_quiz
            if choice_index is None or not 0 <= choice_index < len(quiz.choices):
                raise ValueError("Choose one answer.")
            quiz.answered_index = choice_index
            quiz.status = "answered"
            result = {"question": quiz.question, "selected_answer": quiz.choices[choice_index],
                      "correct": choice_index == quiz.correct_index, "correct_answer": quiz.choices[quiz.correct_index]}
        else:
            question = message.question
            assert question is not None
            if choice_index is not None:
                if not 0 <= choice_index < len(question.choices):
                    raise ValueError("Invalid answer choice.")
                answer = question.choices[choice_index]
            if not answer or not answer.strip():
                raise ValueError("Enter an answer.")
            question.answer = answer.strip()
            question.status = "answered"
            result = {"question": question.question, "answer": question.answer}
        self.publish_message(run, message)
        self.set_state(run, "waiting" if sum(not item.done() for item in run.interactions.values()) > 1 else "running")
        future.set_result(result)
        return {"ok": True, "message": message.model_dump(mode="json")}

    async def interrupt(self, graph_id: str, session_id: str) -> None:
        thread = self.repository.chat_thread(graph_id, session_id)
        run = next((r for r in self.runs.values() if r.session_id == thread.session_id and not r.done.done()), None)
        if run is not None:
            await self.interrupt_run(run)

    async def interrupt_run(self, run: AgentRun) -> None:
        run.cancel_requested = True
        for future in run.interactions.values():
            if not future.done():
                future.set_exception(CodexError("The user stopped this turn."))
        if run.thread_id and run.turn_id:
            await self.transport.request("turn/interrupt", {"threadId": run.thread_id, "turnId": run.turn_id})
        elif run.task and run.task is not asyncio.current_task():
            # Let an in-flight thread/start or turn/start acknowledgement arrive.
            # Cancelling the RPC reader here could leave a native turn running unseen.
            await asyncio.shield(run.task)
        self.finish(run, "interrupted")

    def finish(self, run: AgentRun, status: str, error: str | None = None) -> None:
        if run.done.done():
            return
        status = status if status in {"completed", "interrupted", "failed"} else "failed"
        for future in run.interactions.values():
            if not future.done():
                future.set_exception(CodexError(error or "The turn ended."))
        if run.session_id:
            thread = self.repository.chat_thread(run.graph_id, run.session_id)
            for message in thread.messages:
                changed = False
                if message.agent_status == "streaming":
                    message.agent_status = status
                    changed = True
                if message.activity and message.activity.status == "running":
                    message.activity.status = "failed"
                    message.activity.detail = error or "The turn ended before this tool completed."
                    changed = True
                for widget in (message.question, message.inline_quiz):
                    if widget and widget.status == "pending":
                        widget.status = "interrupted"
                        changed = True
                if changed:
                    self.publish_message(run, message)
        self.set_state(run, status, error)
        self.emit(run, {"type": "turn_completed", "status": status, "error": error})
        run.done.set_result(None)

    async def _disconnected(self, reason: str) -> None:
        self.login = None
        for run in list(self.runs.values()):
            if not run.done.done():
                self.finish(run, "failed", reason)

    async def close(self) -> None:
        for run in list(self.runs.values()):
            if not run.done.done():
                try:
                    await self.interrupt_run(run)
                except CodexError:
                    self.finish(run, "interrupted")
        await self.transport.close()
