from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from app.agent.chatgpt_auth import ChatGPTError
from app.agent.store import AgentStore
from app.core.config import Settings
from app.models.domain import GraphChatRequest, UpdateWorkspaceConfigRequest
from app.services.repository import GraphRepository
from fake_chatgpt import FakeChatGPT, fake_runtime


class AgentRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="clew-runtime-test-")
        self.addCleanup(self.temp.cleanup)
        self.settings = Settings(db_path=Path(self.temp.name) / "state.sqlite3")
        self.repo = GraphRepository(self.settings.db_path)
        self.peer = FakeChatGPT()
        self.runtime = fake_runtime(self.settings, self.repo, self.peer)
        self.addAsyncCleanup(self.runtime.close)
        self.graph_id = "mathematics-demo"

    async def start(self, scenario="answer", **kwargs):
        self.peer.scenario = scenario
        session_id, run_id = await self.runtime.start_chat(self.graph_id, GraphChatRequest(prompt="Help me learn", **kwargs))
        return session_id, self.runtime.runs[run_id]

    async def complete(self, run):
        await asyncio.wait_for(asyncio.shield(run.done), 30)

    async def wait_question(self, run):
        for _ in range(3000):
            if run.interactions:
                return next(iter(run.interactions))
            if run.done.done():
                self.fail(f"Turn ended: {run.error}")
            await asyncio.sleep(.01)
        self.fail("No interaction was delivered")

    async def test_answer_stream_persists_and_replays_without_duplicates(self):
        sid, run = await self.start()
        await self.complete(run)
        thread = self.runtime.store.thread_payload(self.graph_id, sid)
        self.assertEqual(thread["agent_status"], "completed")
        self.assertIn("**learner**", thread["messages"][-1]["content"])
        events = [event async for event in self.runtime.events(sid, run.id)]
        self.assertEqual(events[-1]["type"], "turn_completed")
        partial = [event async for event in self.runtime.events(sid, run.id, events[-2]["event_id"])]
        self.assertEqual(partial, events[-1:])
        self.assertEqual(len(thread["messages"]), 2)
        self.assertEqual(thread["messages"][-1]["reply_id"], run.id)
        self.assertIsNone(thread["messages"][-1]["message_phase"])
        request = self.peer.requests[0]
        self.assertEqual(request["model"], "test-model")
        self.assertNotIn("reasoning", request)
        self.assertEqual({tool["name"] for tool in request["tools"] if tool["type"] == "function"},
                         {"read_graph", "read_topic", "propose_ingest", "propose_expand", "ask_question", "present_quiz", "create_closure_quiz"})
        # Web search is always offered in chat; the model decides whether to use it.
        self.assertIn({"type": "web_search"}, request["tools"])

    async def test_preambles_tools_and_final_answer_keep_one_reply_after_reload(self):
        before = self.repo.current().snapshot.id
        sid, run = await self.start("nested-proposal")
        await self.complete(run)
        thread = AgentStore(self.repo).thread_payload(self.graph_id, sid)
        parts = [message for message in thread["messages"] if message["role"] == "assistant"]
        self.assertEqual(len(parts), 5)
        self.assertEqual({message["reply_id"] for message in parts}, {run.id})
        self.assertEqual([message["message_phase"] for message in parts], ["commentary", None, "commentary", None, "final_answer"])
        self.assertTrue(parts[3]["proposal"]["apply_plan"]["validation"]["ok"])
        self.assertEqual(self.repo.current().snapshot.id, before)
        self.assertEqual(self.repo.list_chat_sessions(self.graph_id)[0].message_count, 2)
        # Each step re-sends the whole transcript, including the earlier call and its output.
        last = self.peer.requests[-1]["input"]
        self.assertEqual([item.get("type") for item in last if item.get("type") in {"function_call", "function_call_output"}],
                         ["function_call", "function_call_output", "function_call", "function_call_output"])

    async def test_next_turn_continues_the_stored_transcript(self):
        sid, first = await self.start()
        await self.complete(first)
        _, second = await self.start(session_id=sid)
        await self.complete(second)
        users = [item for item in self.peer.requests[-1]["input"] if item.get("role") == "user"]
        self.assertEqual(len(users), 2)
        self.assertNotIn("Earlier conversation", json.dumps(users))
        self.assertEqual(len(self.repo.chat_thread(self.graph_id, sid).messages), 4)

    async def test_question_waits_for_free_text_and_agent_receives_the_answer(self):
        sid, run = await self.start("question")
        interaction = await self.wait_question(run)
        self.assertEqual(run.status, "waiting")
        await self.runtime.answer(self.graph_id, sid, interaction, answer="Examples first", choice_index=None)
        await self.complete(run)
        messages = self.repo.chat_thread(self.graph_id, sid).messages
        self.assertEqual(messages[1].question.answer, "Examples first")
        self.assertIn("Examples first", messages[-1].content)
        with self.assertRaises(ValueError):
            await self.runtime.answer(self.graph_id, sid, interaction, answer="again", choice_index=None)

    async def test_inline_quiz_is_graded_on_server(self):
        sid, run = await self.start("inline")
        interaction = await self.wait_question(run)
        await self.runtime.answer(self.graph_id, sid, interaction, answer=None, choice_index=0)
        await self.complete(run)
        messages = self.repo.chat_thread(self.graph_id, sid).messages
        self.assertEqual(messages[1].inline_quiz.answered_index, 0)
        self.assertIn('"correct": false', messages[-1].content)
        self.assertEqual(self.repo.graph(self.graph_id).quiz_attempts, [])

    async def test_proposal_tool_does_not_mutate_graph(self):
        before = self.repo.current().snapshot.id
        sid, run = await self.start("proposal")
        await self.complete(run)
        messages = self.repo.chat_thread(self.graph_id, sid).messages
        self.assertTrue(messages[1].proposal.apply_plan.validation.ok)
        self.assertFalse(messages[1].proposal_applied)
        self.assertEqual(self.repo.current().snapshot.id, before)

    async def test_invalid_operations_return_real_tool_error_and_no_proposal(self):
        sid, run = await self.start("invalid-proposal")
        await self.complete(run)
        messages = self.repo.chat_thread(self.graph_id, sid).messages
        self.assertIsNone(messages[1].proposal)
        self.assertEqual(messages[1].activity.status, "failed")
        self.assertIn("disconnected", messages[-1].content)

    async def test_stop_while_question_pending_keeps_transcript_consistent(self):
        sid, run = await self.start("question")
        await self.wait_question(run)
        await self.runtime.interrupt(self.graph_id, sid)
        await self.complete(run)
        self.assertEqual(run.status, "interrupted")
        self.assertEqual(self.repo.chat_thread(self.graph_id, sid).messages[1].question.status, "interrupted")
        # A function call without its output would be rejected by the next request.
        self.assertIsNone(self.runtime.store.transcript(sid))

    async def test_stop_during_stream_cancels_the_request(self):
        sid, run = await self.start("hold")
        with self.assertRaises(ValueError):
            await self.runtime.start_chat(self.graph_id, GraphChatRequest(prompt="second", session_id=sid))
        await asyncio.sleep(.05)
        await self.runtime.interrupt(self.graph_id, sid)
        await self.complete(run)
        self.assertEqual(run.status, "interrupted")

    async def test_duplicate_client_id_resumes_events_and_rejects_different_content(self):
        sid, run = await self.start(client_message_id="stable-user-id")
        await self.complete(run)
        again = await self.runtime.start_chat(self.graph_id, GraphChatRequest(prompt="Help me learn", session_id=sid, client_message_id="stable-user-id"))
        self.assertEqual(again, (sid, run.id))
        with self.assertRaises(ValueError):
            await self.runtime.start_chat(self.graph_id, GraphChatRequest(prompt="Different", session_id=sid, client_message_id="stable-user-id"))

    async def test_explicit_unavailable_model_fails_without_substitution(self):
        _, run = await self.start(model="hidden-model")
        await self.complete(run)
        self.assertEqual(run.status, "failed")
        self.assertIn("not available", run.error)
        self.assertEqual(self.peer.requests, [])

    async def test_workspace_model_and_effort_are_sent(self):
        self.repo.update_workspace_config(UpdateWorkspaceConfigRequest(default_model="second-model", reasoning_effort="high"))
        _, run = await self.start()
        await self.complete(run)
        self.assertEqual(self.peer.requests[0]["model"], "second-model")
        self.assertEqual(self.peer.requests[0]["reasoning"], {"effort": "high"})

    async def test_no_sign_in_fails_without_hidden_provider(self):
        await self.runtime.close()
        self.runtime = fake_runtime(self.settings, self.repo, self.peer, signed=False)
        _, run = await self.start()
        await self.complete(run)
        self.assertEqual(run.status, "failed")
        self.assertIn("Sign in", run.error)

    async def test_plan_limit_and_stream_failures_surface_explicitly(self):
        for scenario, text in (("usage-limit", "plan limit"), ("stream-error", "does not support"), ("truncated", "before completion")):
            sid, run = await self.start(scenario)
            await self.complete(run)
            self.assertEqual(run.status, "failed", scenario)
            self.assertIn(text, run.error)
            self.assertIsNone(self.runtime.store.transcript(sid))

    async def test_runaway_tool_loop_is_bounded(self):
        _, run = await self.start("loop")
        await self.complete(run)
        self.assertEqual(run.status, "failed")
        self.assertIn("did not finish", run.error)

    async def test_closure_quiz_uses_only_quiz_tools_and_retains_server_answers(self):
        self.peer.scenario = "closure"
        quiz = await asyncio.wait_for(self.runtime.generate_closure_quiz(self.graph_id, "arithmetics", 6, None), 30)
        self.assertEqual(len(quiz.questions), 6)
        self.assertEqual(self.repo.quiz_session(quiz.session_id).questions[0].correct_choice_index, 1)
        self.assertEqual([tool.get("name") for tool in self.peer.requests[0]["tools"]], ["create_closure_quiz", "read_graph", "read_topic"])
        self.assertEqual(self.runtime.runs, {})

    async def test_missing_quiz_tool_result_fails_instead_of_fabricating_test(self):
        self.peer.scenario = "answer"
        with self.assertRaisesRegex(ChatGPTError, "without creating"):
            await asyncio.wait_for(self.runtime.generate_closure_quiz(self.graph_id, "arithmetics", 6, None), 30)

    async def test_recovery_marks_pending_cards_interrupted(self):
        sid, run = await self.start("question")
        await self.wait_question(run)
        AgentStore(self.repo).recover_interrupted()
        thread = self.runtime.store.thread_payload(self.graph_id, sid)
        self.assertEqual(thread["agent_status"], "interrupted")
        self.assertEqual(thread["messages"][1]["question"]["status"], "interrupted")

    async def test_completed_turns_release_memory_and_keep_durable_replay(self):
        for _ in range(4):
            sid, run = await self.start()
            await self.complete(run)
            self.assertEqual(self.runtime.runs, {})
            events = [event async for event in self.runtime.events(sid, run.id)]
            self.assertEqual(events[-1]["type"], "turn_completed")
        self.assertEqual(len(self.repo.chat_thread(self.graph_id, sid).messages), 8)

    async def test_catalog_completion_after_logout_does_not_unlock_account(self):
        entered, release = asyncio.Event(), asyncio.Event()
        async def models():
            entered.set()
            await release.wait()
            return [{"model": "test-model"}]
        self.runtime.models = models
        account = asyncio.create_task(self.runtime.account())
        await asyncio.wait_for(entered.wait(), 2)
        await self.runtime.logout()
        release.set()
        result = await account
        self.assertFalse(result["authenticated"])
        self.assertFalse(result["can_disconnect"])
        self.assertEqual(result["models"], [])
