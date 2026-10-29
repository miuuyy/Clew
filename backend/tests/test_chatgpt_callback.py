import unittest
from urllib.parse import parse_qs, urlparse

from agent_test_support import install_client
from fake_chatgpt import CLIENT_ID, FakeChatGPT


class ChatGPTCallbackTests(unittest.TestCase):
    def setUp(self):
        self.peer = FakeChatGPT()
        self.client, self.repo, self.runtime = install_client(self, signed=False, peer=self.peer)
        self.host = {"host": "127.0.0.1:8787"}

    def start_login(self):
        response = self.client.post("/api/v1/chatgpt/login", json={})
        self.assertEqual(response.status_code, 200, response.text)
        return parse_qs(urlparse(response.json()["authUrl"]).query)

    def test_successful_callback_and_browser_refresh_unlock_the_same_account(self):
        query = self.start_login()
        # The test issuer signs with the nonce from the pending authorization.
        self.peer.nonce = query["nonce"][0]
        params = {"state": query["state"][0], "code": "one-time-code", "client_id": CLIENT_ID}
        for _ in range(2):
            response = self.client.get("/auth/callback", params=params, headers=self.host)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertIn("Return to Clew", response.text)
            self.assertEqual(response.headers["Cache-Control"], "no-store")
            self.assertEqual(response.headers["Referrer-Policy"], "no-referrer")
            self.assertNotIn("one-time-code", response.text)
        account = self.client.get("/api/v1/chatgpt/account").json()
        self.assertTrue(account["authenticated"] and account["sharing"])
        self.assertIsNone(account["login"])
        self.assertEqual(self.client.get("/api/v1/workspace/current").status_code, 200)
        self.assertEqual(len(self.peer.token_requests), 1)

    def test_missing_or_duplicate_state_does_not_consume_the_pending_login(self):
        query = self.start_login()
        for params in ({"code": "one-time-code"},
                       {"state": [query["state"][0], "forged"], "code": "one-time-code"}):
            response = self.client.get("/auth/callback", params=params, headers=self.host)
            self.assertEqual(response.status_code, 400)
            self.assertNotIn("one-time-code", response.text)
            self.assertIsNotNone(self.runtime.auth.pending)
            self.assertFalse(self.client.get("/api/v1/chatgpt/account").json()["authenticated"])
            self.assertEqual(self.client.get("/api/v1/workspace/current").status_code, 401)

    def test_denied_callback_keeps_its_error_on_refresh_and_in_clew(self):
        query = self.start_login()
        params = {"state": query["state"][0], "error": "access_denied"}
        for _ in range(2):
            response = self.client.get("/auth/callback", params=params, headers=self.host)
            self.assertEqual(response.status_code, 400)
            self.assertIn("Sign-in was not completed.", response.text)
        account = self.client.get("/api/v1/chatgpt/account").json()
        self.assertFalse(account["authenticated"])
        self.assertEqual(account["error"], "Sign-in was not completed.")
        self.assertIsNone(account["login"])
