from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path

import httpx

from app.agent.chatgpt_api import ChatGPTClient
from app.agent.chatgpt_auth import ChatGPTError
from fake_chatgpt import FakeChatGPT, fake_auth, signed_in, sse


class ChatGPTClientTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.auth = fake_auth(FakeChatGPT(), Path(temp.name) / "registration.json", signed_in())
        self.addAsyncCleanup(self.auth.close)

    async def client(self, handler):
        http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        self.addAsyncCleanup(http.aclose)
        return ChatGPTClient(self.auth, http)

    async def event(self, event):
        pass

    async def test_catalog_and_response_transport_failures_are_typed(self):
        async def handler(request):
            raise httpx.ConnectError("raw diagnostics", request=request)
        client = await self.client(handler)
        for call in (client.list_models, lambda: client.stream({}, self.event)):
            with self.assertRaises(ChatGPTError) as raised:
                await call()
            self.assertEqual(raised.exception.code, "transport_error")
            self.assertTrue(raised.exception.retryable)
            self.assertTrue(self.auth.status()["authenticated"])

    async def test_transport_failure_during_stream_is_typed(self):
        class BrokenStream(httpx.AsyncByteStream):
            async def __aiter__(self):
                yield b'data: {"type":"response.created"}\n\n'
                raise httpx.ReadError("connection lost")
        client = await self.client(lambda request: httpx.Response(200, stream=BrokenStream()))
        with self.assertRaises(ChatGPTError) as raised:
            await client.stream({}, self.event)
        self.assertEqual(raised.exception.code, "transport_error")
        self.assertTrue(self.auth.status()["authenticated"])

    async def test_rejected_catalog_or_response_token_relocks(self):
        for streaming in (False, True):
            self.auth.store.write(signed_in())
            client = await self.client(lambda request: httpx.Response(401, json={"error": {"code": "invalid_token"}}))
            with self.assertRaises(ChatGPTError):
                await (client.stream({}, self.event) if streaming else client.list_models())
            self.assertFalse(self.auth.status()["authenticated"])
            self.assertIsNone(self.auth.store.read())

    async def test_final_stream_failure_relocks_without_a_blank_line(self):
        event = {"type": "response.failed", "response": {"error": {"code": "invalid_token"}}}
        client = await self.client(lambda request: httpx.Response(200, content=f"data: {json.dumps(event)}".encode()))
        with self.assertRaises(ChatGPTError) as raised:
            await client.stream({}, self.event)
        self.assertEqual(raised.exception.code, "invalid_token")
        self.assertFalse(self.auth.status()["authenticated"])

    async def test_plan_limits_and_transient_failures_keep_credentials(self):
        for status, code in ((429, "subscription_sharing_usage_limit_exceeded"),
                             (503, "subscription_sharing_usage_unavailable")):
            client = await self.client(lambda request: httpx.Response(status, json={"error": {"code": code}}))
            with self.assertRaises(ChatGPTError) as raised:
                await client.list_models()
            self.assertEqual(raised.exception.code, code)
            self.assertTrue(self.auth.status()["authenticated"])

    async def test_delayed_old_token_rejection_preserves_new_connection(self):
        entered, release = asyncio.Event(), asyncio.Event()
        async def handler(request):
            self.assertEqual(request.headers["authorization"], "Bearer access-1")
            entered.set()
            await release.wait()
            return httpx.Response(401, json={"error": {"code": "invalid_token"}})
        client = await self.client(handler)
        request = asyncio.create_task(client.list_models())
        await asyncio.wait_for(entered.wait(), 2)
        self.auth.store.write({**signed_in(), "access_token": "access-new"})
        release.set()
        with self.assertRaises(ChatGPTError):
            await request
        self.assertEqual(await self.auth.access_token(), "access-new")

    async def test_malformed_stream_never_reports_success(self):
        for event in ([], {"type": "response.output_item.done", "output_index": "bad", "item": {}},
                      {"type": "response.completed", "response": {"status": "completed", "output": "bad"}},
                      {"type": "response.completed", "response": {"status": "failed", "output": []}}):
            with self.subTest(event=event):
                client = await self.client(lambda request: httpx.Response(200, content=sse([event])))
                with self.assertRaises(ChatGPTError) as raised:
                    await client.stream({}, self.event)
                self.assertEqual(raised.exception.code, "invalid_stream")

    async def test_completed_event_at_eof_preserves_output_items(self):
        item = {"type": "message", "id": "message-1", "role": "assistant", "content": []}
        data = sse([{"type": "response.output_item.done", "output_index": 0, "item": item}])
        data += b'data: {"type":"response.completed","response":{"status":"completed","output":[]}}'
        client = await self.client(lambda request: httpx.Response(200, content=data))
        self.assertEqual((await client.stream({}, self.event))["output"], [item])
