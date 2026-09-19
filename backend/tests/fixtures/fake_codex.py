#!/usr/bin/env python3
"""Test-only app-server peer. Never selected by application code."""
import json
import os
import sys
import time
from uuid import uuid4

process_id = uuid4().hex[:8]

scenario = os.environ.get("CLEW_CODEX_TEST_SCENARIO", "answer")
turn_number = 0
thread_number = 0
current_thread = ""
current_turn = ""
pending = 0
pending_tool = None
current_context = {}
step_delay = float(os.environ.get("CLEW_CODEX_TEST_STEP_DELAY", "0"))

def send(payload):
    print(json.dumps(payload), flush=True)

def notify(method, params):
    send({"method": method, "params": {"threadId": current_thread, **params}})

def agent_message(text, item_id, phase=None):
    item = {"type": "agentMessage", "id": item_id, "text": "", "phase": phase}
    notify("item/started", {"item": item, "turnId": current_turn})
    midpoint = len(text)//2
    for delta in (text[:midpoint], text[midpoint:]):
        notify("item/agentMessage/delta", {"itemId": item_id, "turnId": current_turn, "delta": delta})
        time.sleep(step_delay)
    notify("item/completed", {"item": {**item, "text": text}, "turnId": current_turn})

def finish(text="Hello **learner**.\n\n- First idea\n- Second idea", phase=None):
    agent_message(text, f"message-{current_turn}", phase)
    notify("turn/completed", {"turn": {"id": current_turn, "status": "completed", "error": None}})

def tool(name, arguments):
    global pending, pending_tool
    pending += 1
    pending_tool = name
    send({"id": f"request-{pending}-{current_turn}", "method": "item/tool/call", "params": {
        "threadId": current_thread, "turnId": current_turn, "callId": f"call-{pending}-{current_turn}",
        "namespace": "clew", "tool": name, "arguments": arguments}})

for line in sys.stdin:
    message = json.loads(line)
    method = message.get("method")
    params = message.get("params", {})
    result = {}
    if method is None:
        result = message.get("result", {})
        if result.get("success"):
            content = result.get("contentItems", [{}])[0].get("text", "")
            if scenario == "nested-proposal":
                if pending_tool == "read_graph":
                    agent_message("I am preparing the graph proposal.", f"progress-{current_turn}", "commentary")
                    tool("propose_expand", {"base_graph_version": current_context["graph_version"], "summary": "Clarify arithmetic", "operations": [{
                        "op_id": "update-arithmetic", "op": "upsert_topic", "entity_kind": "topic", "topic": {
                            "id": "arithmetics", "title": "Arithmetic", "slug": "arithmetics", "description": "Addition and subtraction, explained clearly."}}]})
                else:
                    finish("The proposal is ready for your review.", "final_answer")
                continue
            finish("Tool result received.\n\n" + content if scenario in {"question", "inline"} else "The proposal is ready for your review.")
        else:
            finish("The tool rejected the request: " + json.dumps(result))
        continue
    if method == "initialize":
        assert params["capabilities"]["experimentalApi"] is True
        result = {"userAgent": "Clew test app-server"}
    elif method == "initialized":
        continue
    elif method == "account/read":
        result = {"account": None if scenario == "unauthenticated" else {"type": "chatgpt", "email": "test@example.com", "planType": "plus"}, "requiresOpenaiAuth": True}
    elif method == "account/login/start":
        result = {"type": "chatgpt", "loginId": "test-login", "authUrl": "https://auth.openai.com/test-only"}
    elif method == "model/list":
        result = {"data": [{"id": "test-codex", "model": "test-codex", "displayName": "Test Codex", "description": "A deterministic test peer", "isDefault": True, "hidden": False,
                           "defaultReasoningEffort": "medium", "supportedReasoningEfforts": [{"reasoningEffort": "medium", "description": "Default"}, {"reasoningEffort": "high", "description": "More reasoning"}]}], "nextCursor": None}
    elif method == "thread/start":
        assert params["dynamicTools"][0]["type"] == "namespace"
        assert params["dynamicTools"][0]["name"] == "clew"
        thread_number += 1
        current_thread = f"thread-{thread_number}"
        result = {"thread": {"id": current_thread}}
    elif method == "thread/resume":
        assert "dynamicTools" not in params
        current_thread = params["threadId"]
        result = {"thread": {"id": current_thread}}
    elif method == "turn/start":
        turn_number += 1
        current_turn = f"turn-{process_id}-{turn_number}"
        if scenario == "timeout":
            continue
        send({"id": message["id"], "result": {"turn": {"id": current_turn, "status": "inProgress"}}})
        notify("turn/started", {"turn": {"id": current_turn, "status": "inProgress"}})
        if scenario == "crash":
            sys.exit(3)
        if scenario == "hold":
            continue
        if scenario == "nested-proposal":
            current_context = json.loads(params["input"][0]["text"].split("\n", 1)[1])
            agent_message("I will prepare an arithmetic update.", f"preamble-{current_turn}", "commentary")
            tool("read_graph", {})
        elif scenario == "question":
            tool("ask_question", {"question": "Which part should we explore?", "choices": ["Theory", "Practice"]})
        elif scenario == "inline":
            tool("present_quiz", {"question": "What is 2 + 2?", "choices": ["3", "4", "5", "6"], "correct_index": 1})
        elif scenario in {"closure", "bad-closure"}:
            context = json.loads(params["input"][0]["text"].split("\n", 1)[1])
            count = context["closure_question_count"]
            # An explicit button request carries its exact count in the user prompt.
            import re
            match = re.search(r"exactly (\d+) questions", params["input"][-1]["text"])
            if match: count = int(match[1])
            if scenario == "bad-closure": count -= 1
            tool("create_closure_quiz", {"topic_id": context["selected_topic_id"], "questions": [
                {"prompt": f"What is {i} + 1?", "choices": [str(i), str(i+1), str(i+2), str(i+3)], "correct_choice_index": 1, "explanation": "Add one."} for i in range(count)]})
        elif scenario in {"proposal", "invalid-proposal"}:
            context = json.loads(params["input"][0]["text"].split("\n", 1)[1])
            tool("propose_expand", {"base_graph_version": context["graph_version"], "summary": "Clarify arithmetic", "operations": [{
                "op_id": "update-arithmetic", "op": "upsert_topic", "entity_kind": "topic", "topic": {
                    "id": "arithmetics" if scenario == "proposal" else "isolated", "title": "Arithmetic", "slug": "arithmetics", "description": "Addition and subtraction, explained clearly."}}]})
        else:
            finish()
        continue
    elif method == "turn/interrupt":
        notify("turn/completed", {"turn": {"id": current_turn, "status": "interrupted", "error": None}})
    send({"id": message["id"], "result": result})
