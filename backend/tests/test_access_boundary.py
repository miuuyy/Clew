from __future__ import annotations
import unittest
from unittest.mock import AsyncMock

import httpx

from app.agent.chatgpt_auth import ChatGPTError
from agent_test_support import install_client


class AccessBoundaryTests(unittest.TestCase):
    def test_signed_out_workspace_cannot_be_read_or_mutated(self):
        client, repo, runtime = install_client(self, signed=False)
        snapshot = repo.current().snapshot.id
        for method, path in [("get", "/api/v1/workspace/current"), ("post", "/api/v1/workspace/graphs")]:
            response = getattr(client, method)(path)
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.json()["code"], "not_signed_in")
        self.assertEqual(repo.current().snapshot.id, snapshot)
        self.assertEqual(client.get("/api/v1/chatgpt/account").status_code, 200)

    def test_plan_permission_is_required_and_sign_out_relocks(self):
        client, repo, runtime = install_client(self)
        self.assertEqual(client.get("/api/v1/workspace/current").status_code, 200)
        connection = runtime.auth.store.read()
        runtime.auth.store.write({**connection, "scopes": []})
        self.assertEqual(client.get("/api/v1/workspace/current").status_code, 401)
        runtime.auth.store.write(connection)
        self.assertEqual(client.post("/api/v1/chatgpt/logout").status_code, 200)
        self.assertEqual(client.get("/api/v1/workspace/current").status_code, 401)

    def test_desktop_transport_requires_launch_session(self):
        client, repo, runtime = install_client(self)
        runtime.settings.desktop_token = "a-private-launch-session"
        self.assertEqual(client.get("/api/v1/chatgpt/account").status_code, 403)
        self.assertEqual(client.get("/api/v1/chatgpt/account", headers={"x-clew-session": "forged"}).status_code, 403)
        self.assertEqual(client.get("/api/v1/chatgpt/account", headers={"x-clew-session": "a-private-launch-session"}).status_code, 200)
        self.assertEqual(client.get("/api/v1/chatgpt/account", headers={b"x-clew-session": b"\xff"}).status_code, 403)

    def test_corrupt_credentials_expose_recovery_and_logout_relocks(self):
        client, repo, runtime = install_client(self)
        runtime.auth.store.write({**runtime.auth.store.read(), "expires_at": None})
        account = client.get("/api/v1/chatgpt/account").json()
        self.assertFalse(account["authenticated"])
        self.assertTrue(account["can_disconnect"])
        self.assertEqual(client.get("/api/v1/workspace/current").status_code, 401)
        self.assertTrue(client.post("/api/v1/chatgpt/logout").json()["ok"])
        account = client.get("/api/v1/chatgpt/account").json()
        self.assertFalse(account["authenticated"])
        self.assertFalse(account["can_disconnect"])

    def test_catalog_rejection_relocks_account_and_workspace(self):
        client, repo, runtime = install_client(self)
        http = httpx.AsyncClient(transport=httpx.MockTransport(
            lambda request: httpx.Response(401, json={"error": {"code": "invalid_token"}})))
        runtime.client.http = http
        try:
            response = client.get("/api/v1/chatgpt/account")
            self.assertEqual(response.status_code, 200)
            self.assertFalse(response.json()["authenticated"])
            self.assertFalse(response.json()["can_disconnect"])
            self.assertEqual(client.get("/api/v1/workspace/current").status_code, 401)
        finally:
            import asyncio
            asyncio.run(http.aclose())

    def test_retryable_access_failure_is_explicit_503(self):
        client, repo, runtime = install_client(self)
        runtime.auth.access_token = AsyncMock(side_effect=ChatGPTError("transport_error", "Cannot reach ChatGPT", retryable=True))
        response = client.get("/api/v1/workspace/current")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "transport_error")
