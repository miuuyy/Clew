import json
import unittest
from app.models.domain import ChatMessage, CreateGraphRequest
from codex_test_support import install_client

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
        response = self.client.post(self.url+"/stream", json={"prompt": "hello", "client_message_id": "test-user", "use_grounding": False})
        self.assertEqual(response.status_code, 200)
        events = [json.loads(line) for line in response.text.splitlines()]
        self.assertEqual(events[-1]["status"], "completed")
        thread = self.client.get(self.url).json()
        self.assertEqual(thread["messages"][0]["id"], "test-user")
        self.assertEqual(thread["messages"][-1]["agent_status"], "completed")
        self.assertTrue(thread["codex_thread_id"])
        replay = self.client.get(self.url+f"/events?session_id={thread['session_id']}&after={thread['last_event_id']}")
        self.assertEqual(replay.text, "")

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

    def test_graph_recreation_does_not_inherit_old_codex_binding(self):
        self.client.post(self.url+"/stream", json={"prompt": "old conversation"})
        sid = self.repository.chat_thread(self.graph_id).session_id
        self.assertTrue(self.runtime.store.binding(sid)["thread_id"])
        self.repository.delete_graph(self.graph_id)
        self.repository.create_graph(CreateGraphRequest(title="Mathematics demo", subject="math"))
        self.assertEqual(self.repository.chat_thread(self.graph_id).messages, [])
        self.assertIsNone(self.runtime.store.binding(sid)["thread_id"])

    def test_legacy_messages_are_preserved_when_connecting_codex(self):
        self.repository.append_chat_message(self.graph_id, ChatMessage(role="assistant", content="Prior lesson", model="legacy-model"))
        self.client.post(self.url+"/stream", json={"prompt": "Continue"})
        messages = self.client.get(self.url).json()["messages"]
        self.assertEqual(messages[0]["content"], "Prior lesson")
        self.assertEqual(len(messages), 3)
