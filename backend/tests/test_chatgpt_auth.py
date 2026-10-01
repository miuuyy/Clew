from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from app.agent.chatgpt_auth import ChatGPTError, api_error
from fake_chatgpt import CLIENT_ID, FakeChatGPT, fake_auth, signed_in


class ChatGPTAuthTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="clew-auth-test-")
        self.addCleanup(self.temp.cleanup)
        self.registration = Path(self.temp.name) / "chatgpt-registration.json"
        self.peer = FakeChatGPT()

    async def auth(self, connection=None):
        auth = fake_auth(self.peer, self.registration, connection)
        self.addAsyncCleanup(auth.close)
        return auth

    async def sign_in(self, auth, nonce=None, scenario="answer", **overrides):
        login = await auth.start_login()
        query = parse_qs(urlparse(login.auth_url).query)
        self.peer.nonce = nonce or query["nonce"][0]
        self.peer.scenario = scenario
        callback = {"state": [login.state], "code": ["code-1"], "client_id": [CLIENT_ID], **overrides}
        await auth.complete_login(callback)
        return query

    async def test_first_sign_in_registers_dynamically_and_stores_tokens(self):
        auth = await self.auth()
        query = await self.sign_in(auth)
        self.assertEqual(query["client_id"], ["dynamic_agent_client"])
        self.assertEqual(query["agent_name_hint"], ["Clew"])
        self.assertIn("chatgpt.tokens.use.direct", query["scope"][0])
        self.assertEqual(query["code_challenge_method"], ["S256"])
        exchange = self.peer.token_requests[0]
        self.assertEqual((exchange["client_id"], exchange["redirect_uri"]), (CLIENT_ID, "http://127.0.0.1:8787/auth/callback"))
        self.assertTrue(exchange["code_verifier"])
        status = auth.status()
        self.assertTrue(status["authenticated"] and status["sharing"])
        self.assertEqual(status["account"]["email"], "learner@example.com")
        self.assertEqual(await auth.access_token(), "access-1")
        self.assertNotIn("access-1", self.registration.read_text())

    async def test_repeat_sign_in_reuses_registration(self):
        auth = await self.auth()
        await self.sign_in(auth)
        query = await self.sign_in(auth)
        self.assertEqual(query["client_id"], [CLIENT_ID])
        self.assertEqual(query["login_hint"], ["learner@example.com"])
        self.assertNotIn("agent_name_hint", query)

    async def test_wrong_nonce_or_state_is_rejected(self):
        auth = await self.auth()
        with self.assertRaisesRegex(ChatGPTError, "could not be verified"):
            await self.sign_in(auth, nonce="other")
        self.assertFalse(auth.status()["authenticated"])
        await auth.start_login()
        with self.assertRaisesRegex(ChatGPTError, "not the one Clew started"):
            await auth.complete_login({"state": ["forged"], "code": ["x"]})

    async def test_denied_consent_and_missing_sharing_scope_are_explicit(self):
        auth = await self.auth()
        login = await auth.start_login()
        with self.assertRaisesRegex(ChatGPTError, "not completed"):
            await auth.complete_login({"state": [login.state], "error": ["access_denied"]})
        await self.sign_in(auth, scenario="no-sharing")
        self.assertFalse(auth.status()["sharing"])
        with self.assertRaisesRegex(ChatGPTError, "Plan sharing was not granted"):
            await auth.access_token()

    async def test_expiring_token_refreshes_and_rotates(self):
        auth = await self.auth(signed_in(expires_in=10))
        self.assertEqual(await auth.access_token(), "access-2")
        self.assertEqual(self.peer.token_requests[0]["refresh_token"], "refresh-1")
        self.assertEqual(auth.store.read()["refresh_token"], "refresh-2")
        self.assertGreater(auth.store.read()["expires_at"], time.time() + 3000)

    async def test_rejected_refresh_requires_sign_in(self):
        self.peer.scenario = "refresh-denied"
        auth = await self.auth(signed_in(expires_in=10))
        with self.assertRaisesRegex(ChatGPTError, "Sign in again"):
            await auth.access_token()

    async def test_logout_removes_tokens_keeps_registration_and_revokes(self):
        auth = await self.auth(signed_in())
        self.assertIsNone(await auth.logout())
        self.assertEqual(self.peer.revoked, ["refresh-1"])
        self.assertIsNone(auth.store.read())
        self.assertEqual(auth.registration()["client_id"], CLIENT_ID)
        self.assertFalse(auth.status()["authenticated"])

    def test_error_codes_map_to_plan_messages(self):
        self.assertIn("Plus or Pro", str(api_error({"error": {"code": "subscription_sharing_v2_user_not_eligible"}}, 403)))
        error = api_error({"error": {"code": "subscription_sharing_usage_unavailable"}}, 503)
        self.assertTrue(error.retryable)
        self.assertEqual(str(api_error({"error": {"code": "other", "message": "Server text"}}, 400)), "Server text")
        self.assertEqual(str(api_error({"detail": "Input must be a list"}, 400)), "Input must be a list")
