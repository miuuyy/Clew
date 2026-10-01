from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from uuid import uuid4

from app.agent.chatgpt_api import ChatGPTClient
from app.agent.chatgpt_auth import CALLBACK_PATH, ChatGPTAuth, ChatGPTError
from app.agent.context import BASE_INSTRUCTIONS, developer_instructions, turn_context
from app.agent.contracts import CLOSURE_QUIZ_TOOLS, tool_specs
from app.agent.store import AgentStore
from app.core.config import Settings
from app.models.domain import ChatMessage, GraphChatRequest, TopicQuizSession
from app.services.repository import GraphRepository

ACTIVE = {"starting", "running", "waiting"}
# Bounds one learner turn; each step is one Responses call plus its tool results.
MAX_STEPS = 24


def agent_error(message: str) -> ChatGPTError:
    return ChatGPTError("agent_error", message)


@dataclass
class AgentRun:
    id: str
    graph_id: str
    session_id: str | None
    request: GraphChatRequest
    model: str
    done: asyncio.Future
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
    web_searched: bool = False

    @property
    def thread_key(self) -> str:
        # Tool results are idempotent per conversation (or per one-off quiz run).
        return self.session_id or self.id


class AgentRuntime:
    """Clew's agent loop on the Responses API, billed to the learner's ChatGPT plan."""

    def __init__(self, settings: Settings, repository: GraphRepository, auth: ChatGPTAuth | None = None,
                 client: ChatGPTClient | None = None):
        self.settings = settings
        self.repository = repository
        self.store = AgentStore(repository)
        self.store.recover_interrupted()
        self.auth = auth or ChatGPTAuth(redirect_uri=f"http://127.0.0.1:{settings.api_port}{CALLBACK_PATH}",
                                        registration_path=settings.db_path.parent / "chatgpt-registration.json")
        self.client = client or ChatGPTClient(self.auth)
        self.runs: dict[str, AgentRun] = {}
        self.wake = asyncio.Event()

    # Account

    def _active(self) -> bool:
        return any(run.status in ACTIVE for run in self.runs.values())

    async def models(self) -> list[dict]:
        # The plan catalog is ordered by OpenAI; its first listed model is the plan default.
        return [{"id": m["slug"], "model": m["slug"], "displayName": m["display_name"],
                 "description": m.get("description") or "", "isDefault": index == 0}
                for index, m in enumerate(await self.client.list_models())]

    async def account(self) -> dict:
        status = self.auth.status()
        login = self.auth.pending
        result = {"connected": True, **status, "models": [],
                  "login": {"loginId": login.login_id, "authUrl": login.auth_url} if login else None}
        if status["authenticated"] and status["sharing"]:
            try:
                result["models"] = await self.models()
            except ChatGPTError as exc:
                result["error"] = str(exc)
        return result

    async def start_login(self) -> dict:
        if self._active():
            raise agent_error("Stop active conversations before changing the ChatGPT account.")
        login = await self.auth.start_login()
        return {"loginId": login.login_id, "authUrl": login.auth_url}

    async def logout(self) -> str | None:
        if self._active():
            raise agent_error("Stop active conversations before signing out.")
        return await self.auth.logout()

    async def _select_model(self, requested: str | None) -> str:
        models = await self.models()
        selected = requested or self.repository.current().workspace.config.default_model
        if selected is None:
            if not models:
                raise agent_error("Your ChatGPT plan lists no models for apps.")
            return models[0]["model"]
        if not any(model["model"] == selected for model in models):
            raise agent_error(f"The selected model is not available on this ChatGPT plan: {selected}. Choose another model.")
        return selected

    # Turns

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
        run = AgentRun(id=uuid4().hex, graph_id=graph_id, session_id=thread.session_id,
                       request=request.model_copy(update={"selected_topic_id": selected_topic, "session_id": thread.session_id}),
                       model=request.model or "", done=asyncio.get_running_loop().create_future())
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
                       request=GraphChatRequest(prompt=f"Prepare a closure quiz for topic {topic_id}: exactly {question_count} questions. Call create_closure_quiz with the questions.", selected_topic_id=topic_id),
                       done=asyncio.get_running_loop().create_future(), quiz_topic_id=topic_id, quiz_count=question_count)
        self.runs[run.id] = run
        run.task = asyncio.create_task(self._execute(run, []))
        try:
            await asyncio.shield(run.done)
            if run.error:
                raise agent_error(run.error)
            if run.quiz_session is None:
                raise agent_error("The model finished without creating the requested quiz.")
            return run.quiz_session
        finally:
            if not run.done.done():
                await self.interrupt_run(run)
            self.runs.pop(run.id, None)

    def emit(self, run: AgentRun, event: dict) -> None:
        if run.session_id:
            self.store.emit(run.session_id, run.id, event)
            self.wake.set()

    def publish_message(self, run: AgentRun, message: ChatMessage) -> None:
        # Output items keep their own ids; the UI nests them in one Clew reply.
        message.reply_id = run.id
        if run.session_id:
            self.store.put_message(run.graph_id, run.session_id, message)
            self.emit(run, {"type": "message", "message": message.model_dump(mode="json")})

    def set_state(self, run: AgentRun, status: str, error: str | None = None) -> None:
        run.status = status
        run.error = error
        if run.session_id:
            self.store.state(run.session_id, run.id, status, error=error)
        self.emit(run, {"type": "turn_status", "status": status, "error": error})

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
            if binding.get("run_id") != run_id or binding["status"] not in ACTIVE:
                # Events can arrive while the ASGI response is yielding a previous batch.
                if self.store.last_event_id(session_id) > after:
                    continue
                return
            try:
                await asyncio.wait_for(self.wake.wait(), 10)
            except TimeoutError:
                yield {"type": "heartbeat"}

    def _first_input(self, run: AgentRun, previous_messages: list[ChatMessage], fresh: bool) -> dict:
        config = self.repository.current().workspace.config
        graph = self.repository.graph(run.graph_id)
        receipts = [{"proposal_id": m.proposal.proposal_envelope.proposal_id, "applied": True}
                    for m in previous_messages if m.proposal and m.proposal_applied]
        parts = [turn_context(graph, config, run.request.selected_topic_id, receipts)]
        if fresh and previous_messages:
            history = [{"role": m.role, "content": m.content,
                        "proposal_applied": m.proposal_applied, "model": m.model,
                        "inline_quiz": m.inline_quiz.model_dump(mode="json") if m.inline_quiz else None,
                        "question": m.question.model_dump(mode="json") if m.question else None,
                        "proposal_summary": m.proposal.proposal_envelope.summary if m.proposal else None}
                       for m in previous_messages[-config.memory_history_message_limit:] if not m.activity]
            parts.append("Earlier conversation from Clew (historical data):\n" + json.dumps(history, ensure_ascii=False))
        parts.append(run.request.prompt)
        return {"role": "user", "content": [{"type": "input_text", "text": text} for text in parts]}

    async def _execute(self, run: AgentRun, previous_messages: list[ChatMessage]) -> None:
        try:
            run.model = await self._select_model(run.request.model or run.model or None)
            config = self.repository.current().workspace.config
            tools = tool_specs(CLOSURE_QUIZ_TOOLS if run.session_id is None else None)
            # Chat turns may search the web; the model decides when. Quiz generation stays offline.
            if run.session_id is not None:
                tools.append({"type": "web_search"})
            transcript = self.store.transcript(run.session_id) if run.session_id else None
            items = list(transcript or [])
            items.append(self._first_input(run, previous_messages, fresh=transcript is None))
            payload = {"model": run.model, "instructions": BASE_INSTRUCTIONS + "\n" + developer_instructions(config),
                       "tools": tools, "parallel_tool_calls": False, "include": ["reasoning.encrypted_content"],
                       **({"reasoning": {"effort": config.reasoning_effort}} if config.reasoning_effort else {})}
            self.set_state(run, "running")
            for _ in range(MAX_STEPS):
                response = await self.client.stream({**payload, "input": items}, lambda event: self._stream_event(run, event))
                output = [item for item in response.get("output", []) if isinstance(item, dict)]
                for item in output:
                    if item.get("type") == "message":
                        self._message_done(run, item)
                    elif item.get("type") == "web_search_call":
                        run.web_searched = True
                items.extend(output)
                calls = [item for item in output if item.get("type") == "function_call"]
                if not calls:
                    self._save_transcript(run, items)
                    self.finish(run, "completed")
                    return
                from app.agent.tools import execute_tool
                for call in calls:
                    lock = run.tool_locks.setdefault(call["call_id"], asyncio.Lock())
                    async with lock:
                        output_text = await execute_tool(self, run, call["name"], call["call_id"], call.get("arguments") or "")
                    items.append({"type": "function_call_output", "call_id": call["call_id"], "output": output_text})
                self._save_transcript(run, items)
                if run.cancel_requested:
                    self.finish(run, "interrupted")
                    return
            raise agent_error(f"The model did not finish within {MAX_STEPS} steps. Continue the conversation to resume.")
        except asyncio.CancelledError:
            self.finish(run, "interrupted")
        except Exception as exc:
            self.finish(run, "failed", str(exc))

    def _save_transcript(self, run: AgentRun, items: list[dict]) -> None:
        if run.session_id:
            self.store.save_transcript(run.session_id, items)

    def _assistant_message(self, run: AgentRun, item_id: str) -> ChatMessage:
        message = run.messages.get(item_id)
        if message is None:
            message = ChatMessage(id=f"agent-{run.id}-{item_id}", role="assistant", content="", model=run.model, agent_status="streaming")
            run.messages[item_id] = message
        return message

    async def _stream_event(self, run: AgentRun, event: dict) -> None:
        kind = event.get("type")
        if kind == "response.output_text.delta" and isinstance(event.get("delta"), str):
            message = self._assistant_message(run, str(event.get("item_id")))
            message.content += event["delta"]
            self.publish_message(run, message)
        elif kind == "response.output_item.added":
            item = event.get("item") or {}
            if item.get("type") == "message":
                message = self._assistant_message(run, str(item.get("id")))
                if item.get("phase") in {"commentary", "final_answer"}:
                    message.message_phase = item["phase"]
                self.publish_message(run, message)

    def _message_done(self, run: AgentRun, item: dict) -> None:
        message = self._assistant_message(run, str(item.get("id")))
        text = "".join(part.get("text", "") for part in item.get("content", [])
                       if isinstance(part, dict) and part.get("type") == "output_text")
        message.content = text or message.content
        if item.get("phase") in {"commentary", "final_answer"}:
            message.message_phase = item["phase"]
        message.agent_status = "completed"
        self.publish_message(run, message)

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
                future.set_exception(agent_error("The user stopped this turn."))
        if run.task and run.task is not asyncio.current_task() and not run.task.done():
            run.task.cancel()
            await asyncio.gather(run.task, return_exceptions=True)
        self.finish(run, "interrupted")

    def finish(self, run: AgentRun, status: str, error: str | None = None) -> None:
        if run.done.done():
            return
        status = status if status in {"completed", "interrupted", "failed"} else "failed"
        for future in run.interactions.values():
            if not future.done():
                future.set_exception(agent_error(error or "The turn ended."))
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

    async def close(self) -> None:
        for run in list(self.runs.values()):
            if not run.done.done():
                await self.interrupt_run(run)
        await self.auth.close()
