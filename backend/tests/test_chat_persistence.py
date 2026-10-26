import json
import unittest
from app.models.domain import ChatMessage, CreateGraphRequest
from agent_test_support import install_client

class ChatPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.client, self.repository, self.runtime = install_client(self)
        self.graph_id = "mathematics-demo"
        self.url = f"/api/v1/graphs/{self.graph_id}/chat"

    def test_repository_keeps_one_stable_thread_per_graph(self):
        first = self.repository.chat_thread(self.graph_id)
        self.repository.append_chat_message(self.graph_id, ChatMessage(role="user", content="hello"))
        thread = self.repository.append_chat_message(self.graph_id, ChatMessage(role="assistant", content="world"))
        self.assertEqual(first.session_id, thread.session_id)
        self.assertEqual([m.content for m in thread.messages], ["hello", "world"])

    def test_native_stream_and_get_return_same_persisted_conversation(self):
        response = self.client.post(self.url+"/stream", json={"prompt": "hello", "client_message_id": "test-user"})
        self.assertEqual(response.status_code, 200)
        events = [json.loads(line) for line in response.text.splitlines()]
        self.assertEqual(events[-1]["status"], "completed")
        thread = self.client.get(self.url).json()
        self.assertEqual(thread["messages"][0]["id"], "test-user")
        self.assertEqual(thread["messages"][-1]["agent_status"], "completed")
        self.assertTrue(self.runtime.store.transcript(thread["session_id"]))
        replay = self.client.get(self.url+f"/events?session_id={thread['session_id']}&after={thread['last_event_id']}")
        self.assertEqual(replay.text, "")

    def test_quiz_card_finishes_stream_and_answer_opens_a_new_replayable_reply(self):
        client, repository, runtime = install_client(self, scenario="inline")
        response = client.post(self.url+"/stream", json={"prompt": "Give me a quiz"})
        self.assertEqual(response.status_code, 200)
        events = [json.loads(line) for line in response.text.splitlines()]
        self.assertEqual(events[-1]["type"], "turn_completed")
        self.assertEqual(events[-1]["status"], "completed")
        thread = client.get(self.url).json()
        card = thread["messages"][1]
        self.assertEqual(card["inline_quiz"]["status"], "pending")
        self.assertEqual(runtime.runs, {})
        body = {"session_id": thread["session_id"], "interaction_id": card["inline_quiz"]["interaction_id"], "choice_index": 1, "model": "second-model"}
        answer = client.post(self.url+"/answer", json=body)
        self.assertEqual(answer.status_code, 200)
        self.assertNotEqual(answer.json()["run_id"], thread["run_id"])
        replay = client.get(self.url+f"/events?session_id={thread['session_id']}&after={thread['last_event_id']}")
        resumed = [json.loads(line) for line in replay.text.splitlines()]
        self.assertEqual(resumed[-1]["type"], "turn_completed")
        self.assertEqual(resumed[-1]["status"], "completed")
        final = client.get(self.url).json()
        self.assertEqual(final["messages"][1]["inline_quiz"]["status"], "answered")
        self.assertEqual(final["messages"][-1]["model"], "second-model")
        self.assertIn('"correct": true', final["messages"][-1]["content"])
        self.assertEqual(len([m for m in final["messages"] if m["role"] == "user"]), 1)
        self.assertEqual(client.post(self.url+"/answer", json=body).status_code, 409)

    def test_session_count_groups_native_replies_and_keeps_legacy_messages(self):
        for message in [ChatMessage(role="assistant", content="Prior lesson"),
                        ChatMessage(role="user", content="Continue"),
                        ChatMessage(role="assistant", reply_id="run", content="Preparing", message_phase="commentary"),
                        ChatMessage(role="assistant", reply_id="run", content="Ready", message_phase="final_answer"),
                        ChatMessage(role="user", content="Internal button request", hidden=True)]:
            self.repository.append_chat_message(self.graph_id, message)
        summary = self.client.get(self.url+"/sessions").json()[0]
        self.assertEqual(summary["message_count"], 3)

    def test_unknown_and_cross_graph_sessions_are_rejected(self):
        other = self.repository.create_graph(CreateGraphRequest(title="Other", subject="test"))
        graph_id = other.workspace.active_graph_id
        other_session = self.repository.chat_thread(graph_id).session_id
        for session in ("missing", other_session):
            self.assertEqual(self.client.get(self.url+f"?session_id={session}").status_code, 404)
            self.assertEqual(self.client.post(self.url+"/stream", json={"prompt": "hi", "session_id": session}).status_code, 404)

    def test_topic_chat_creation_and_deletion_keep_general_thread(self):
        response = self.client.post(self.url+"/sessions", json={"topic_id": "functions", "title": "Functions"})
        self.assertEqual(response.status_code, 200)
        sid = response.json()["session_id"]
        self.assertEqual(self.client.delete(self.url+f"/sessions/{sid}").status_code, 200)
        general = self.repository.chat_thread(self.graph_id).session_id
        self.assertEqual(self.client.delete(self.url+f"/sessions/{general}").status_code, 400)

    def test_graph_recreation_does_not_inherit_old_transcript(self):
        self.client.post(self.url+"/stream", json={"prompt": "old conversation"})
        sid = self.repository.chat_thread(self.graph_id).session_id
        self.assertTrue(self.runtime.store.transcript(sid))
        self.repository.delete_graph(self.graph_id)
        self.repository.create_graph(CreateGraphRequest(title="Mathematics demo", subject="math"))
        self.assertEqual(self.repository.chat_thread(self.graph_id).messages, [])
        self.assertIsNone(self.runtime.store.transcript(sid))

    def test_legacy_messages_are_preserved_and_imported_once(self):
        self.repository.append_chat_message(self.graph_id, ChatMessage(role="assistant", content="Prior lesson", model="legacy-model"))
        self.client.post(self.url+"/stream", json={"prompt": "Continue"})
        messages = self.client.get(self.url).json()["messages"]
        self.assertEqual(messages[0]["content"], "Prior lesson")
        self.assertEqual(len(messages), 3)

    def test_empty_explicit_model_is_rejected_without_using_default(self):
        response = self.client.post(self.url+"/stream", json={"prompt": "hello", "model": ""})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.repository.chat_thread(self.graph_id).messages, [])
