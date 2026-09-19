from __future__ import annotations

import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.agent.runtime import CodexRuntime
from app.agent.store import AgentStore
from app.core.config import Settings
from app.models.domain import ChatMessage, GraphChatRequest, UpdateWorkspaceConfigRequest
from app.services.repository import GraphRepository

FIXTURE = Path(__file__).parent / "fixtures" / "fake_codex.py"

class CodexRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="clew-runtime-test-")
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.settings = Settings(db_path=root/"state.sqlite3", codex_home=root/"codex", codex_workspace=root/"work", codex_binary=str(FIXTURE.resolve()), codex_rpc_timeout_seconds=30)
        self.repo = GraphRepository(self.settings.db_path)
        self.runtime = CodexRuntime(self.settings, self.repo)
        self.addAsyncCleanup(self.runtime.close)
        self.graph_id = "mathematics-demo"

    async def start(self, scenario="answer", **kwargs):
        with patch.dict(os.environ, {"CLEW_CODEX_TEST_SCENARIO": scenario}):
            session_id, run_id = await self.runtime.start_chat(self.graph_id, GraphChatRequest(prompt="Help me learn", use_grounding=False, **kwargs))
            run = self.runtime.runs[run_id]
            await asyncio.wait_for(asyncio.shield(run.task), 60)
        return session_id, run

    async def complete(self, run):
        await asyncio.wait_for(asyncio.shield(run.done), 60)

    async def wait_question(self, run):
        for _ in range(6000):
            if run.interactions: return next(iter(run.interactions))
            if run.done.done(): self.fail(f"Turn ended: {run.error}")
            await asyncio.sleep(.01)
        self.fail("No interaction was delivered")

    async def test_native_answer_stream_persists_and_replays_without_duplicates(self):
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
        self.assertEqual(thread["run_id"], run.id)
        self.assertEqual(thread["messages"][-1]["reply_id"], run.id)
        self.assertIsNone(thread["messages"][-1]["message_phase"])

    async def test_preambles_tools_and_final_answer_keep_one_reply_after_reload(self):
        before = self.repo.current().snapshot.id
        sid, run = await self.start("nested-proposal")
        await self.complete(run)
        # Read through a fresh store to exercise the persisted HTTP history payload.
        thread = AgentStore(self.repo).thread_payload(self.graph_id, sid)
        parts = [message for message in thread["messages"] if message["role"] == "assistant"]
        self.assertEqual(len(parts), 5)
        self.assertEqual({message["reply_id"] for message in parts}, {run.id})
        self.assertEqual([message["message_phase"] for message in parts], ["commentary", None, "commentary", None, "final_answer"])
        self.assertTrue(parts[3]["proposal"]["apply_plan"]["validation"]["ok"])
        self.assertEqual(self.repo.current().snapshot.id, before)
        events = [event async for event in self.runtime.events(sid, run.id)]
        self.assertTrue(all(event["message"]["reply_id"] == run.id for event in events if event["type"] == "message"))
        self.assertEqual(self.repo.list_chat_sessions(self.graph_id)[0].message_count, 2)

    async def test_existing_conversation_resumes_the_same_native_thread(self):
        sid, first = await self.start()
        await self.complete(first)
        native_id = first.thread_id
        _, second = await self.start(session_id=sid)
        await self.complete(second)
        self.assertEqual(second.thread_id, native_id)
        self.assertEqual(len(self.repo.chat_thread(self.graph_id, sid).messages), 4)
        self.assertNotEqual(first.id, second.id)
        self.assertEqual([message.reply_id for message in self.repo.chat_thread(self.graph_id, sid).messages if message.role == "assistant"], [first.id, second.id])

    async def test_question_waits_for_free_text_and_agent_receives_the_answer(self):
        sid, run = await self.start("question")
        interaction = await self.wait_question(run)
        self.assertEqual(run.status, "waiting")
        self.assertFalse(run.done.done())
        await self.runtime.answer(self.graph_id, sid, interaction, answer="Examples first", choice_index=None)
        await self.complete(run)
        messages = self.repo.chat_thread(self.graph_id, sid).messages
        self.assertEqual(messages[1].question.answer, "Examples first")
        self.assertIn("Examples first", messages[-1].content)
        with self.assertRaises(ValueError):
            await self.runtime.answer(self.graph_id, sid, interaction, answer="again", choice_index=None)

    async def test_inline_quiz_is_graded_on_server_and_sent_back_to_codex(self):
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

    async def test_stop_while_question_pending_releases_native_tool_request(self):
        sid, run = await self.start("question")
        await self.wait_question(run)
        await self.runtime.interrupt(self.graph_id, sid)
        await self.complete(run)
        self.assertEqual(run.status, "interrupted")
        self.assertEqual(self.repo.chat_thread(self.graph_id, sid).messages[1].question.status, "interrupted")

    async def test_duplicate_client_id_resumes_events_and_rejects_different_content(self):
        sid, run = await self.start(client_message_id="stable-user-id")
        await self.complete(run)
        again = await self.runtime.start_chat(self.graph_id, GraphChatRequest(prompt="Help me learn", session_id=sid, client_message_id="stable-user-id"))
        self.assertEqual(again, (sid, run.id))
        self.assertEqual(len(self.repo.chat_thread(self.graph_id, sid).messages), 2)
        with self.assertRaises(ValueError):
            await self.runtime.start_chat(self.graph_id, GraphChatRequest(prompt="Different", session_id=sid, client_message_id="stable-user-id"))

    async def test_same_session_rejects_overlapping_turns(self):
        sid, run = await self.start("hold")
        with self.assertRaises(ValueError):
            await self.runtime.start_chat(self.graph_id, GraphChatRequest(prompt="second", session_id=sid))
        await self.runtime.interrupt(self.graph_id, sid)
        await self.complete(run)

    async def test_explicit_unavailable_model_fails_without_substitution(self):
        sid, run = await self.start(model="does-not-exist")
        await self.complete(run)
        self.assertEqual(run.status, "failed")
        self.assertIn("unavailable", run.error)
        self.assertIsNone(run.thread_id)

    async def test_unsupported_reasoning_fails_explicitly(self):
        self.repo.update_workspace_config(UpdateWorkspaceConfigRequest(reasoning_effort="ultra"))
        _, run = await self.start()
        await self.complete(run)
        self.assertEqual(run.status, "failed")
        self.assertIn("does not support", run.error)

    async def test_no_auth_fails_without_hidden_provider(self):
        _, run = await self.start("unauthenticated")
        await self.complete(run)
        self.assertEqual(run.status, "failed")
        self.assertIn("Sign in", run.error)

    async def test_process_exit_closes_turn_and_marks_failure(self):
        _, run = await self.start("crash")
        await self.complete(run)
        self.assertEqual(run.status, "failed")

    async def test_rpc_timeout_closes_process_and_turn(self):
        # Measure the deliberately unanswered RPC, not subprocess startup under host load.
        with patch.dict(os.environ, {"CLEW_CODEX_TEST_SCENARIO": "timeout"}):
            await self.runtime.connect()
        self.settings.codex_rpc_timeout_seconds = .1
        _, run = await self.start("timeout")
        await self.complete(run)
        self.assertEqual(run.status, "failed")
        self.assertIn("not retried", run.error)
        self.assertIsNone(self.runtime.transport.process)

    async def test_closure_quiz_uses_the_native_tool_and_retains_server_answers(self):
        with patch.dict(os.environ, {"CLEW_CODEX_TEST_SCENARIO": "closure"}):
            quiz = await asyncio.wait_for(self.runtime.generate_closure_quiz(self.graph_id, "arithmetics", 6, None), 60)
        self.assertEqual(len(quiz.questions), 6)
        self.assertEqual(self.repo.quiz_session(quiz.session_id).questions[0].correct_choice_index, 1)
        self.assertEqual(self.repo.graph(self.graph_id).quiz_attempts, [])

    async def test_missing_quiz_tool_result_fails_instead_of_fabricating_test(self):
        with patch.dict(os.environ, {"CLEW_CODEX_TEST_SCENARIO": "answer"}):
            with self.assertRaisesRegex(RuntimeError, "without creating"):
                await asyncio.wait_for(self.runtime.generate_closure_quiz(self.graph_id, "arithmetics", 6, None), 60)

    async def test_recovery_marks_pending_cards_interrupted_and_keeps_native_binding(self):
        sid, run = await self.start("question")
        await self.wait_question(run)
        AgentStore(self.repo).recover_interrupted()
        thread = self.runtime.store.thread_payload(self.graph_id, sid)
        self.assertEqual(thread["codex_thread_id"], run.thread_id)
        self.assertEqual(thread["agent_status"], "interrupted")
        self.assertEqual(thread["messages"][1]["question"]["status"], "interrupted")
