from __future__ import annotations

import asyncio
import json
import tempfile
import time
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch

import httpx

from app.agent.chatgpt_auth import ChatGPTError, KeyringCredentialStore, api_error
from app.agent.runtime import AgentRuntime
from app.core.config import Settings
from app.services.repository import GraphRepository
from fake_chatgpt import CLIENT_ID, FakeChatGPT, fake_auth, id_token, signed_in


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

    async def transport(self, auth, handler):
        await auth.http.aclose()
        auth.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    async def test_first_sign_in_registers_dynamically_and_stores_tokens(self):
        auth = await self.auth()
        query = await self.sign_in(auth)
        self.assertEqual(query["client_id"], ["dynamic_agent_client"])
        self.assertEqual(query["agent_name_hint"], ["Clew"])
        self.assertTrue(query["ext_agent_host_id"][0].startswith("urn:uuid:"))
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


    async def test_callback_keeps_polling_active_until_identity_and_credentials_are_saved(self):
        auth = await self.auth()
        login = await auth.start_login()
        self.peer.nonce = login.nonce
        entered, release = asyncio.Event(), asyncio.Event()
        async def handler(request):
            if request.url.path == "/oauth/token":
                entered.set()
                await release.wait()
            return await self.peer(request)
        await self.transport(auth, handler)
        settings = Settings(db_path=Path(self.temp.name) / "state.sqlite3")
        runtime = AgentRuntime(settings, GraphRepository(settings.db_path), auth=auth)
        self.addAsyncCleanup(runtime.close)
        completion = asyncio.create_task(auth.complete_login({"state": [login.state], "code": ["code"], "client_id": [CLIENT_ID]}))
        await asyncio.wait_for(entered.wait(), 2)
        try:
            account = await runtime.account()
            self.assertFalse(account["authenticated"])
            self.assertEqual(account["login"]["phase"], "completing")
            self.assertEqual((await auth.start_login()).login_id, login.login_id)
            with self.assertRaises(ChatGPTError):
                await auth.complete_login({"state": [login.state], "code": ["duplicate"], "client_id": [CLIENT_ID]})
        finally:
            release.set()
            await completion
        self.assertIsNone(auth.completing)
        self.assertTrue(auth.status()["sharing"])

    async def test_repeat_sign_in_reuses_registration(self):
        auth = await self.auth()
        first = await self.sign_in(auth)
        query = await self.sign_in(auth)
        self.assertEqual(query["ext_agent_host_id"], first["ext_agent_host_id"])
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
        self.assertFalse(auth.status()["authenticated"])

    async def test_logout_removes_tokens_keeps_registration_and_revokes(self):
        auth = await self.auth(signed_in())
        self.assertIsNone(await auth.logout())
        self.assertEqual(self.peer.revoked, ["refresh-1"])
        self.assertIsNone(auth.store.read())
        self.assertEqual(auth.registration()["client_id"], CLIENT_ID)
        self.assertFalse(auth.status()["authenticated"])

    async def test_logout_clears_corrupt_keyring_without_parsing_tokens(self):
        import keyring
        auth = await self.auth()
        raw = {"value": "{broken-json"}
        store = KeyringCredentialStore()
        class RawKeyring:
            errors = keyring.errors
            def get_password(self, *args):
                return raw["value"]
            def delete_password(self, *args):
                raw["value"] = None
        with patch.object(store, "_keyring", return_value=RawKeyring()):
            auth.store = store
            self.assertFalse(auth.status()["authenticated"])
            self.assertTrue(auth.status()["can_disconnect"])
            self.assertIn("Local credentials were removed", await auth.logout())
            self.assertIsNone(raw["value"])

    async def test_logout_clears_mismatched_or_incomplete_credentials(self):
        for changes in ({"client_id": "wrong-install"}, {"subject": "another-user"},
                        {"expires_at": None}, {"scopes": None}, {"access_token": None}):
            with self.subTest(changes=changes):
                auth = await self.auth(signed_in())
                auth.store.write({**signed_in(), **changes})
                self.assertFalse(auth.status()["authenticated"])
                self.assertTrue(auth.status()["can_disconnect"])
                with self.assertRaises(ChatGPTError):
                    await auth.access_token()
                await auth.logout()
                self.assertIsNone(auth.store.read())

    async def test_failed_keyring_deletion_is_explicit(self):
        import keyring
        auth = await self.auth()
        store = KeyringCredentialStore()
        class LockedKeyring:
            errors = keyring.errors
            def get_password(self, *args):
                return "{broken-json"
            def delete_password(self, *args):
                raise keyring.errors.PasswordDeleteError("locked")
        with patch.object(store, "_keyring", return_value=LockedKeyring()):
            auth.store = store
            with self.assertRaisesRegex(ChatGPTError, "could not remove"):
                await auth.logout()

    async def test_malformed_discovery_and_jwks_are_typed_errors(self):
        for path, body in [("/.well-known/openid-configuration", b"<html>oops</html>"),
                           ("/jwks", b"not-json"), ("/jwks", b'{"keys":[null]}'),
                           ("/jwks", b'{"keys":[{"kid":"test-key","kty":"RSA","n":"bad"}]}')]:
            with self.subTest(path=path, body=body):
                auth = await self.auth()
                async def handler(request):
                    return httpx.Response(200, content=body) if request.url.path == path else await self.peer(request)
                await self.transport(auth, handler)
                with self.assertRaises(ChatGPTError) as raised:
                    await self.sign_in(auth)
                self.assertTrue(raised.exception.retryable)
                self.assertFalse(auth.status()["authenticated"])

    async def test_transport_errors_are_typed_and_do_not_disclose_requests(self):
        for path in ("/.well-known/openid-configuration", "/oauth/token", "/jwks"):
            with self.subTest(path=path):
                auth = await self.auth()
                async def handler(request):
                    if request.url.path == path:
                        raise httpx.ConnectError("secret credential in transport diagnostics", request=request)
                    return await self.peer(request)
                await self.transport(auth, handler)
                with self.assertRaises(ChatGPTError) as raised:
                    await self.sign_in(auth)
                self.assertEqual(raised.exception.code, "transport_error")
                self.assertTrue(raised.exception.retryable)
                self.assertNotIn("secret credential", str(raised.exception))

    async def test_logout_reports_remote_discovery_failure_after_removing_tokens(self):
        auth = await self.auth(signed_in())
        await self.transport(auth, lambda request: httpx.Response(200, content=b"bad-json"))
        self.assertIn("Local credentials were removed", await auth.logout())
        self.assertFalse(auth.status()["authenticated"])

    async def test_invalid_refresh_credentials_and_identity_relock(self):
        for changes in ({"id_token": id_token(subject="another-user")}, {"id_token": "broken"},
                        {"id_token": None}, {"expires_in": float("nan")}, {"expires_in": True},
                        {"scope": []}, {"access_token": ""}):
            with self.subTest(changes=changes):
                auth = await self.auth(signed_in(expires_in=10))
                async def handler(request):
                    response = await self.peer(request)
                    if request.url.path == "/oauth/token":
                        return httpx.Response(200, content=json.dumps({**response.json(), **changes}).encode())
                    return response
                await self.transport(auth, handler)
                with self.assertRaises(ChatGPTError):
                    await auth.access_token()
                self.assertFalse(auth.status()["authenticated"])
                self.assertIsNone(auth.store.read())

    async def test_refresh_does_not_retain_revoked_plan_sharing(self):
        auth = await self.auth(signed_in(expires_in=10))
        async def handler(request):
            response = await self.peer(request)
            return httpx.Response(200, json={**response.json(), "scope": "openid"}) if request.url.path == "/oauth/token" else response
        await self.transport(auth, handler)
        with self.assertRaises(ChatGPTError) as raised:
            await auth.access_token()
        self.assertEqual(raised.exception.code, "sharing_not_granted")
        self.assertFalse(auth.status()["sharing"])

    async def test_logout_invalidates_inflight_refresh_and_waiting_refresh(self):
        auth = await self.auth(signed_in(expires_in=10))
        entered, release = asyncio.Event(), asyncio.Event()
        async def handler(request):
            if request.url.path == "/oauth/token":
                entered.set()
                await release.wait()
            return await self.peer(request)
        await self.transport(auth, handler)
        first = asyncio.create_task(auth.access_token())
        await asyncio.wait_for(entered.wait(), 2)
        second = asyncio.create_task(auth.access_token())
        await auth.logout()
        release.set()
        results = await asyncio.gather(first, second, return_exceptions=True)
        self.assertTrue(all(isinstance(result, ChatGPTError) for result in results))
        self.assertIsNone(auth.store.read())
        self.assertEqual(len(self.peer.token_requests), 1)

    async def test_old_refresh_success_or_failure_cannot_replace_new_login(self):
        for denied in (False, True):
            with self.subTest(denied=denied):
                auth = await self.auth(signed_in(expires_in=10))
                entered, release = asyncio.Event(), asyncio.Event()
                async def handler(request):
                    if request.url.path == "/oauth/token" and b"grant_type=refresh_token" in request.content:
                        entered.set()
                        await release.wait()
                        if denied:
                            return httpx.Response(400, json={"error": "invalid_grant"})
                    return await self.peer(request)
                await self.transport(auth, handler)
                refresh = asyncio.create_task(auth.access_token())
                await asyncio.wait_for(entered.wait(), 2)
                await auth.logout()
                await self.sign_in(auth)
                release.set()
                with self.assertRaises(ChatGPTError):
                    await refresh
                self.assertEqual(await auth.access_token(), "access-1")
                self.assertTrue(auth.status()["authenticated"])

    async def test_logout_or_cancel_invalidates_inflight_login(self):
        for cancel in (False, True):
            with self.subTest(cancel=cancel):
                auth = await self.auth()
                login = await auth.start_login()
                self.peer.nonce = login.nonce
                entered, release = asyncio.Event(), asyncio.Event()
                async def handler(request):
                    if request.url.path == "/oauth/token":
                        entered.set()
                        await release.wait()
                    return await self.peer(request)
                await self.transport(auth, handler)
                completion = asyncio.create_task(auth.complete_login({"state": [login.state], "code": ["code"], "client_id": [CLIENT_ID]}))
                await asyncio.wait_for(entered.wait(), 2)
                if cancel:
                    auth.cancel_login()
                else:
                    await auth.logout()
                release.set()
                with self.assertRaises(ChatGPTError) as raised:
                    await completion
                self.assertEqual(raised.exception.code, "connection_changed")
                self.assertIsNone(auth.store.read())
                self.assertIsNone(auth.pending)

    async def test_cancel_during_discovery_does_not_reopen_login(self):
        auth = await self.auth()
        entered, release = asyncio.Event(), asyncio.Event()
        async def handler(request):
            entered.set()
            await release.wait()
            return await self.peer(request)
        await self.transport(auth, handler)
        start = asyncio.create_task(auth.start_login())
        await asyncio.wait_for(entered.wait(), 2)
        auth.cancel_login()
        release.set()
        with self.assertRaises(ChatGPTError):
            await start
        self.assertIsNone(auth.pending)

    async def test_non_ascii_state_is_a_typed_rejection(self):
        auth = await self.auth()
        await auth.start_login()
        with self.assertRaises(ChatGPTError) as raised:
            await auth.complete_login({"state": ["\u043d\u0435\u0432\u0435\u0440\u043d\u043e"], "code": ["code"]})
        self.assertEqual(raised.exception.code, "invalid_state")

    async def test_canceling_login_does_not_discard_a_valid_concurrent_refresh(self):
        auth = await self.auth(signed_in(expires_in=10))
        entered, release = asyncio.Event(), asyncio.Event()
        async def handler(request):
            if request.url.path == "/oauth/token":
                entered.set()
                await release.wait()
            return await self.peer(request)
        await self.transport(auth, handler)
        refresh = asyncio.create_task(auth.access_token())
        await asyncio.wait_for(entered.wait(), 2)
        await auth.start_login()
        auth.cancel_login()
        release.set()
        self.assertEqual(await refresh, "access-2")
        self.assertEqual(await auth.access_token(), "access-2")

    def test_error_codes_map_to_plan_messages(self):
        self.assertIn("Plus or Pro", str(api_error({"error": {"code": "subscription_sharing_v2_user_not_eligible"}}, 403)))
        error = api_error({"error": {"code": "subscription_sharing_usage_unavailable"}}, 503)
        self.assertTrue(error.retryable)
        self.assertEqual(str(api_error({"error": {"code": "other", "message": "Server text"}}, 400)), "Server text")
        self.assertEqual(str(api_error({"detail": "Input must be a list"}, 400)), "Input must be a list")
