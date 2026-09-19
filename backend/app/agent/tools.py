from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING

from app.agent.context import graph_context
from app.agent.contracts import TOOL_MODELS, ClosureQuizDraft, InlineQuizDraft, ProposalDraft, QuestionDraft
from app.models.domain import AgentActivity, AgentQuestion, ChatMessage, InlineChatQuiz, QuizQuestion, TopicQuizSessionPublic
from app.services.proposal_service import ProposalService
from app.services.quiz_service import QuizService

if TYPE_CHECKING:
    from app.agent.runtime import AgentRun, CodexRuntime


LABELS = {
    "read_graph": "Reading your graph",
    "read_topic": "Reading the topic",
    "propose_ingest": "Preparing a graph proposal",
    "propose_expand": "Preparing a graph proposal",
    "ask_question": "Waiting for your answer",
    "present_quiz": "Waiting for your answer",
    "create_closure_quiz": "Preparing your test",
}


def public_quiz(session) -> TopicQuizSessionPublic:
    return TopicQuizSessionPublic.model_validate(session.model_dump(mode="json"))


async def execute_tool(runtime: CodexRuntime, run: AgentRun, params: dict) -> dict:
    tool = params["tool"]
    call_id = params["callId"]
    arguments = params.get("arguments")
    canonical = json.dumps({"tool": tool, "namespace": params.get("namespace"), "arguments": arguments}, sort_keys=True, ensure_ascii=False)
    cached = runtime.store.tool_result(call_id, params["threadId"], canonical)
    if cached is not None:
        return cached
    message = ChatMessage(id=f"tool-{call_id}", role="assistant", content="", model=run.model,
                          activity=AgentActivity(id=call_id, tool=tool, status="running", detail=LABELS.get(tool, tool)))
    try:
        if params.get("namespace") != "clew" or tool not in LABELS:
            raise ValueError("Unknown Clew tool.")
        if run.quiz_topic_id and tool not in {"read_graph", "read_topic", "create_closure_quiz"}:
            raise ValueError("This turn can only prepare the requested completion test.")
        if not isinstance(arguments, dict):
            raise ValueError("Tool arguments must be a JSON object.")
        parsed = TOOL_MODELS[tool].model_validate(arguments) if tool in TOOL_MODELS else None
        runtime.publish_message(run, message)
        graph = runtime.repository.graph(run.graph_id)
        if tool == "read_graph":
            if arguments:
                raise ValueError("read_graph takes no arguments.")
            result = graph_context(graph)
        elif tool == "read_topic":
            if set(arguments) != {"topic_id"}:
                raise ValueError("read_topic requires only topic_id.")
            topic = next((t for t in graph.topics if t.id == arguments["topic_id"]), None)
            if topic is None:
                raise ValueError("Topic not found in this conversation's graph.")
            result = {"graph_version": graph.version, "topic": topic.model_dump(mode="json"),
                      "closure": QuizService(runtime.settings).build_closure_status(graph, topic.id).model_dump(mode="json")}
        elif tool in {"propose_ingest", "propose_expand"}:
            assert isinstance(parsed, ProposalDraft)
            proposal = ProposalService().prepare(graph, parsed, tool=tool, proposal_id=f"prop-{call_id}",
                prompt=run.request.prompt, model=run.model, use_grounding=run.request.use_grounding)
            message.proposal = proposal
            message.action = tool
            result = {"status": "awaiting_review", "proposal_id": proposal.proposal_envelope.proposal_id,
                      "base_graph_version": graph.version, "preview": proposal.apply_plan.preview.model_dump(),
                      "message": "The proposal is ready in Clew. The user must accept it before the graph changes."}
        elif tool in {"ask_question", "present_quiz"}:
            interaction_id = f"question-{call_id}"
            future = asyncio.get_running_loop().create_future()
            run.interactions[interaction_id] = future
            if isinstance(parsed, QuestionDraft):
                message.question = AgentQuestion(interaction_id=interaction_id, question=parsed.question, choices=parsed.choices)
            else:
                assert isinstance(parsed, InlineQuizDraft)
                message.inline_quiz = InlineChatQuiz(interaction_id=interaction_id, question=parsed.question,
                                                     choices=parsed.choices, correct_index=parsed.correct_index)
            runtime.publish_message(run, message)
            runtime.set_state(run, "waiting")
            try:
                result = await future
                # The answer handler persisted the answered card. Keep that canonical version.
                if run.session_id:
                    message = next(m for m in runtime.repository.chat_thread(run.graph_id, run.session_id).messages if m.id == message.id)
            finally:
                run.interactions.pop(interaction_id, None)
        elif tool == "create_closure_quiz":
            assert isinstance(parsed, ClosureQuizDraft)
            if run.quiz_topic_id and parsed.topic_id != run.quiz_topic_id:
                raise ValueError("The test must be for the requested topic.")
            config = runtime.repository.current().workspace.config
            count = run.quiz_count or config.quiz_question_count
            questions = [QuizQuestion(id=f"{call_id}-{index}", prompt=q.prompt, choices=q.choices,
                         correct_choice_index=q.correct_choice_index, explanation=q.explanation)
                         for index, q in enumerate(parsed.questions)]
            session = QuizService(runtime.settings).start_session(graph, parsed.topic_id, count, questions=questions, generator=run.model)
            session.session_id = f"quiz-{call_id}"
            runtime.repository.save_quiz_session(session)
            run.quiz_session = session
            message.closure_quiz = public_quiz(session)
            result = {"status": "ready", "session_id": session.session_id, "topic_id": session.topic_id,
                      "question_count": session.question_count, "message": "The learner takes the test in Clew. Clew grades it and awards completion."}
        else:
            raise ValueError("Unknown Clew tool.")
        message.activity.status = "completed"
        runtime.publish_message(run, message)
        response = {"success": True, "contentItems": [{"type": "inputText", "text": json.dumps(result, ensure_ascii=False)}]}
    except Exception as exc:
        message.activity.status = "failed"
        message.activity.detail = str(exc)
        for widget in (message.question, message.inline_quiz):
            if widget and widget.status == "pending":
                widget.status = "interrupted"
        runtime.publish_message(run, message)
        response = {"success": False, "contentItems": [{"type": "inputText", "text": json.dumps({"error": str(exc)}, ensure_ascii=False)}]}
    runtime.store.save_tool_result(call_id, params["threadId"], canonical, response)
    return response
