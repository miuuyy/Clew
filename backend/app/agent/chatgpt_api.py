from __future__ import annotations

import json
from collections.abc import Awaitable, Callable

import httpx

from app.agent.chatgpt_auth import ChatGPTAuth, ChatGPTError, api_error

API_BASE = "https://api.openai.com/v1"
MAX_EVENT_BYTES = 4 * 1024 * 1024


class ChatGPTClient:
    """Responses API calls billed to the signed-in user's ChatGPT plan."""

    def __init__(self, auth: ChatGPTAuth, http: httpx.AsyncClient | None = None):
        self.auth = auth
        self.http = http or auth.http

    async def list_models(self) -> list[dict]:
        token = await self.auth.access_token()
        response = await self.http.get(f"{API_BASE}/models", headers={"authorization": f"Bearer {token}", "accept": "application/json"})
        body = _json(response)
        if response.status_code != 200:
            raise api_error(body, response.status_code)
        if not isinstance(body, dict) or not isinstance(body.get("models"), list):
            raise ChatGPTError("invalid_model_catalog", "ChatGPT returned an unexpected model catalog.", retryable=True)
        models = []
        for model in body["models"]:
            if not isinstance(model, dict) or model.get("visibility") != "list":
                continue
            if not isinstance(model.get("slug"), str) or not isinstance(model.get("display_name"), str):
                raise ChatGPTError("invalid_model_catalog", "ChatGPT returned an incomplete model listing.", retryable=True)
            models.append(model)
        return models

    async def stream(self, payload: dict, on_event: Callable[[dict], Awaitable[None]]) -> dict:
        """Stream one response. Returns the completed response with its output items;
        anything short of response.completed is an error."""
        token = await self.auth.access_token()
        body = {**payload, "store": False, "stream": True}
        async with self.http.stream("POST", f"{API_BASE}/responses", json=body, headers={
            "authorization": f"Bearer {token}", "content-type": "application/json", "accept": "text/event-stream",
        }) as response:
            if response.status_code != 200:
                await response.aread()
                raise api_error(_json(response), response.status_code)
            content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
            # The plan-sharing route may omit Content-Type on a valid event stream.
            if content_type and content_type != "text/event-stream":
                raise ChatGPTError("invalid_stream", "ChatGPT did not return the expected response stream.", retryable=True)
            data_lines: list[str] = []
            size = 0
            # The plan-sharing route delivers output items only as output_item.done events;
            # its response.completed carries an empty output list.
            items: dict[int, dict] = {}
            async for line in response.aiter_lines():
                if line == "":
                    event = _dispatch(data_lines)
                    data_lines, size = [], 0
                    if event is None:
                        continue
                    kind = event.get("type")
                    if kind in {"response.failed", "error"}:
                        failure = event.get("response") if isinstance(event.get("response"), dict) else event
                        raise api_error(failure, response.status_code)
                    if kind == "response.incomplete":
                        reason = ((event.get("response") or {}).get("incomplete_details") or {}).get("reason")
                        raise ChatGPTError("response_incomplete", f"ChatGPT stopped before completing the response{f' ({reason})' if reason else ''}.", retryable=True)
                    if kind == "response.completed":
                        return _completed(event, items)
                    if kind == "response.output_item.done" and isinstance(event.get("item"), dict):
                        items[int(event.get("output_index", len(items)))] = event["item"]
                    await on_event(event)
                elif line.startswith("data:"):
                    content = line[5:].removeprefix(" ")
                    size += len(content)
                    if size > MAX_EVENT_BYTES:
                        raise ChatGPTError("invalid_stream", "ChatGPT returned an oversized stream event.")
                    data_lines.append(content)
            event = _dispatch(data_lines)
            if event and event.get("type") == "response.completed":
                return _completed(event, items)
        raise ChatGPTError("stream_interrupted", "The ChatGPT response ended before completion. Try again.", retryable=True)


def _completed(event: dict, items: dict[int, dict]) -> dict:
    response = event.get("response")
    if not isinstance(response, dict):
        raise ChatGPTError("invalid_stream", "ChatGPT returned an invalid completed response.", retryable=True)
    if not response.get("output") and items:
        response = {**response, "output": [items[index] for index in sorted(items)]}
    return response


def _dispatch(lines: list[str]) -> dict | None:
    data = "\n".join(lines)
    if not data or data == "[DONE]":
        return None
    try:
        event = json.loads(data)
    except json.JSONDecodeError as exc:
        raise ChatGPTError("invalid_stream", "The ChatGPT response stream contained an invalid event.", retryable=True) from exc
    return event if isinstance(event, dict) else None


def _json(response: httpx.Response) -> object:
    try:
        return response.json()
    except ValueError:
        return None
