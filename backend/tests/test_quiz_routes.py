import unittest
from unittest.mock import AsyncMock
from app.agent.transport import CodexError
from codex_test_support import install_client

class QuizRouteTests(unittest.TestCase):
    def setUp(self):
        self.client, self.repo, self.runtime = install_client(self, "closure")
        self.url = "/api/v1/graphs/mathematics-demo/topics/arithmetics/quiz"

    def test_quiz_start_uses_native_tool_and_public_response_hides_answers(self):
        response = self.client.post(self.url+"/start", json={"question_count": 6})
        self.assertEqual(response.status_code, 200, response.text)
        session = response.json()["session"]
        self.assertEqual(len(session["questions"]), 6)
        self.assertNotIn("correct_choice_index", session["questions"][0])
        second = self.client.post(self.url+"/start", json={})
        self.assertEqual(second.json()["session"]["session_id"], session["session_id"])
        answers = [{"question_id": q["id"], "choice_index": 1} for q in session["questions"]]
        submitted = self.client.post(self.url+"/submit", json={"session_id": session["session_id"], "answers": answers})
        self.assertEqual(submitted.status_code, 200, submitted.text)
        self.assertTrue(submitted.json()["attempt"]["passed"])
        self.assertTrue(submitted.json()["attempt"]["closure_awarded"])
        self.assertEqual(self.client.post(self.url+"/submit", json={"session_id": session["session_id"], "answers": answers}).status_code, 404)

    def test_native_failure_returns_explicit_502(self):
        self.runtime.generate_closure_quiz = AsyncMock(side_effect=CodexError("Codex connection closed"))
        response = self.client.post(self.url+"/start", json={})
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["detail"], "Codex connection closed")

    def test_open_prerequisites_block_test(self):
        response = self.client.post("/api/v1/graphs/mathematics-demo/topics/embeddings/quiz/start", json={})
        self.assertEqual(response.status_code, 400)

    def test_quiz_cannot_be_submitted_to_another_topic(self):
        session = self.client.post(self.url+"/start", json={"question_count": 6}).json()["session"]
        response = self.client.post("/api/v1/graphs/mathematics-demo/topics/functions/quiz/submit", json={"session_id": session["session_id"], "answers": []})
        self.assertEqual(response.status_code, 400)
