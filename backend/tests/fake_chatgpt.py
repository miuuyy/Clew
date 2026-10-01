"""Test-only ChatGPT peer: OAuth issuer and plan-sharing Responses API over httpx.MockTransport.
Never selected by application code."""
from __future__ import annotations

import asyncio
import json
import re
import time
from pathlib import Path
from urllib.parse import parse_qs

import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

from app.agent.chatgpt_api import ChatGPTClient
from app.agent.chatgpt_auth import CALLBACK_PATH, ISSUER, SCOPES, ChatGPTAuth
from app.agent.runtime import AgentRuntime

CLIENT_ID = "oaiapp_test"
MODELS = [{"slug": "test-model", "display_name": "Test Model", "description": "A deterministic test peer", "visibility": "list"},
          {"slug": "hidden-model", "display_name": "Hidden", "visibility": "hide"},
          {"slug": "second-model", "display_name": "Second Model", "visibility": "list"}]
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


class MemoryStore:
    def __init__(self, value: dict | None = None):
        self.value = value

    def read(self):
        return dict(self.value) if self.value else None

    def write(self, value):
        self.value = dict(value)

    def delete(self):
        self.value = None


def id_token(nonce: str | None = None, subject: str = "user-1", audience: str = CLIENT_ID) -> str:
    now = int(time.time())
    claims = {"iss": ISSUER, "aud": audience, "sub": subject, "iat": now, "exp": now + 600,
              "email": "learner@example.com", "name": "Learner"}
    if nonce:
        claims["nonce"] = nonce
    return jwt.encode(claims, KEY, algorithm="RS256", headers={"kid": "test-key"})


def signed_in(expires_in: float = 3600) -> dict:
    return {"client_id": CLIENT_ID, "subject": "user-1", "access_token": "access-1", "refresh_token": "refresh-1",
            "expires_at": time.time() + expires_in, "scopes": SCOPES.split()}


def sse(events: list[dict]) -> bytes:
    return "".join(f"data: {json.dumps(event)}\n\n" for event in events).encode()


class FakeChatGPT:
    def __init__(self, scenario: str = "answer"):
        self.scenario = scenario
        self.requests: list[dict] = []
        self.revoked: list[str] = []
        self.token_requests: list[dict] = []
        self.counter = 0
        self.nonce: str | None = None

    # Transport

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        url = request.url
        if url.host == "auth.openai.com":
            return self.auth(request)
        if url.path == "/v1/models":
            assert request.headers["authorization"].startswith("Bearer access-")
            return httpx.Response(200, json={"models": MODELS})
        if url.path == "/v1/responses":
            body = json.loads(request.content)
            self.requests.append(body)
            return await self.responses(body)
        return httpx.Response(404)

    def auth(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/.well-known/openid-configuration":
            return httpx.Response(200, json={"issuer": ISSUER, "authorization_endpoint": f"{ISSUER}/authorize",
                                             "token_endpoint": f"{ISSUER}/oauth/token", "jwks_uri": f"{ISSUER}/jwks",
                                             "revocation_endpoint": f"{ISSUER}/oauth/revoke"})
        if path == "/jwks":
            jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(KEY.public_key()))
            return httpx.Response(200, json={"keys": [{**jwk, "kid": "test-key", "alg": "RS256", "use": "sig"}]})
        form = {key: values[0] for key, values in parse_qs(request.content.decode()).items()}
        if path == "/oauth/token":
            self.token_requests.append(form)
            if form["grant_type"] == "authorization_code":
                scope = SCOPES.replace(" chatgpt.tokens.use.direct", "") if self.scenario == "no-sharing" else SCOPES
                return httpx.Response(200, json={"access_token": "access-1", "refresh_token": "refresh-1", "token_type": "Bearer",
                                                 "expires_in": 3600, "scope": scope, "id_token": id_token(self.nonce)})
            if self.scenario == "refresh-denied":
                return httpx.Response(400, json={"error": "invalid_grant"})
            return httpx.Response(200, json={"access_token": "access-2", "refresh_token": "refresh-2", "token_type": "Bearer",
                                             "expires_in": 3600, "id_token": id_token()})
        if path == "/oauth/revoke":
            self.revoked.append(form["token"])
            return httpx.Response(200)
        return httpx.Response(404)

    # Responses API

    def _message(self, text: str, phase: str | None = None) -> tuple[list[dict], dict]:
        self.counter += 1
        item_id = f"msg_{self.counter}"
        item = {"type": "message", "id": item_id, "role": "assistant", "status": "completed",
                "content": [{"type": "output_text", "text": text, "annotations": []}], **({"phase": phase} if phase else {})}
        midpoint = len(text) // 2
        events = [{"type": "response.output_item.added", "item": {**item, "content": [], "status": "in_progress"}}]
        events += [{"type": "response.output_text.delta", "item_id": item_id, "delta": part} for part in (text[:midpoint], text[midpoint:]) if part]
        return events, item

    def _call(self, name: str, arguments: dict) -> dict:
        self.counter += 1
        return {"type": "function_call", "id": f"fc_{self.counter}", "call_id": f"call_{self.counter}",
                "name": name, "arguments": json.dumps(arguments), "status": "completed"}

    def _complete(self, events: list[dict], output: list[dict]) -> httpx.Response:
        # Like the live plan-sharing route: items arrive as output_item.done; completed has an empty output.
        events = events + [{"type": "response.output_item.done", "output_index": index, "item": item} for index, item in enumerate(output)]
        events += [{"type": "response.completed", "response": {"id": f"resp_{self.counter}", "status": "completed", "output": []}}]
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=sse(events))

    def _reply(self, text: str, phase: str | None = None, before: list[dict] | None = None) -> httpx.Response:
        events, item = self._message(text, phase)
        return self._complete(events, [*(before or []), item])

    async def responses(self, body: dict) -> httpx.Response:
        assert body["store"] is False and body["stream"] is True
        assert all(tool["type"] in {"function", "web_search"} for tool in body["tools"])
        items = body["input"]
        last_user = max(index for index, item in enumerate(items) if item.get("role") == "user")
        user = items[last_user]
        context = json.loads(user["content"][0]["text"].split("\n", 1)[1])
        prompt = user["content"][-1]["text"]
        outputs = [item for item in items[last_user:] if item.get("type") == "function_call_output"]
        step = len(outputs)
        scenario = self.scenario
        if scenario == "hold":
            await asyncio.sleep(3600)
        if scenario == "usage-limit":
            return httpx.Response(429, json={"error": {"code": "subscription_sharing_usage_limit_exceeded", "message": "limit"}})
        if scenario == "stream-error":
            return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=sse([
                {"type": "response.failed", "response": {"error": {"code": "subscription_sharing_unsupported_capability", "message": "no"}}}]))
        if scenario == "truncated":
            events, _ = self._message("Partial")
            return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=sse(events))
        if scenario == "nested-proposal":
            if step == 0:
                events, item = self._message("I will prepare an arithmetic update.", "commentary")
                return self._complete(events, [item, self._call("read_graph", {})])
            if step == 1:
                version = json.loads(outputs[0]["output"])["version"]
                events, item = self._message("I am preparing the graph proposal.", "commentary")
                return self._complete(events, [item, self._call("propose_expand", self._proposal(version, "arithmetics"))])
            return self._reply("The proposal is ready for your review.", "final_answer")
        if scenario == "loop":
            return self._complete([], [self._call("read_graph", {})])
        if step:
            output = outputs[-1]["output"]
            if '"error"' in output:
                return self._reply("The tool rejected the request: " + output)
            if scenario in {"question", "inline"}:
                return self._reply("Tool result received.\n\n" + output)
            return self._reply("The proposal is ready for your review.")
        if scenario == "question":
            return self._complete([], [self._call("ask_question", {"question": "Which part should we explore?", "choices": ["Theory", "Practice"]})])
        if scenario == "inline":
            return self._complete([], [self._call("present_quiz", {"question": "What is 2 + 2?", "choices": ["3", "4", "5", "6"], "correct_index": 1})])
        if scenario in {"closure", "bad-closure"}:
            count = context["closure_question_count"]
            match = re.search(r"exactly (\d+) questions", prompt)
            if match:
                count = int(match[1])
            if scenario == "bad-closure":
                count -= 1
            return self._complete([], [self._call("create_closure_quiz", {"topic_id": context["selected_topic_id"], "questions": [
                {"prompt": f"What is {i} + 1?", "choices": [str(i), str(i + 1), str(i + 2), str(i + 3)], "correct_choice_index": 1, "explanation": "Add one."}
                for i in range(count)]})])
        if scenario in {"proposal", "invalid-proposal"}:
            return self._complete([], [self._call("propose_expand", self._proposal(context["graph_version"], "arithmetics" if scenario == "proposal" else "isolated"))])
        return self._reply("Hello **learner**.\n\n- First idea\n- Second idea")

    @staticmethod
    def _proposal(version: int, topic_id: str) -> dict:
        return {"base_graph_version": version, "summary": "Clarify arithmetic", "operations": [{
            "op_id": "update-arithmetic", "op": "upsert_topic", "entity_kind": "topic", "topic": {
                "id": topic_id, "title": "Arithmetic", "slug": "arithmetics", "description": "Addition and subtraction, explained clearly."}}]}


def fake_auth(peer: FakeChatGPT, registration_path: Path, connection: dict | None = None) -> ChatGPTAuth:
    auth = ChatGPTAuth(redirect_uri=f"http://127.0.0.1:8787{CALLBACK_PATH}", registration_path=registration_path,
                       store=MemoryStore(connection), http=httpx.AsyncClient(transport=httpx.MockTransport(peer)))
    if connection:
        auth._save_registration(client_id=connection["client_id"], subject=connection["subject"], email="learner@example.com", name="Learner")
    return auth


def fake_runtime(settings, repository, peer: FakeChatGPT, signed: bool = True) -> AgentRuntime:
    auth = fake_auth(peer, settings.db_path.parent / "chatgpt-registration.json", signed_in() if signed else None)
    return AgentRuntime(settings, repository, auth=auth, client=ChatGPTClient(auth))
