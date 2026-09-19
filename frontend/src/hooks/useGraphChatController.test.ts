import { describe, expect, it } from "vitest";
import { consumeAgentEvents, reduceAgentEvent, stateFromThread } from "../lib/agentEvents";
import type { GraphChatState } from "../lib/appContracts";
import type { ChatMessage, GraphChatStreamEvent, GraphChatThread } from "../lib/types";
const message: ChatMessage = { id: "same", role: "assistant", content: "Hello", created_at: "2026-09-06T00:00:00Z" };
const empty: GraphChatState = { input: "draft", messages: [] };
describe("native chat events", () => {
  it("upserts streamed text by item id without duplicate bubbles", () => {
    const first = reduceAgentEvent(empty, { type: "message", message, event_id: 1 });
    const second = reduceAgentEvent(first, { type: "message", message: { ...message, content: "Hello world" }, event_id: 2 });
    expect(second.messages).toHaveLength(1);
    expect(second.messages[0].content).toBe("Hello world");
    expect(second.input).toBe("draft");
  });
  it("ignores replayed older events after a reconnect", () => {
    const first = reduceAgentEvent(empty, { type: "message", message: { ...message, proposal_applied: true }, event_id: 20 });
    expect(reduceAgentEvent(first, { type: "message", message, event_id: 19 })).toBe(first);
  });
  it("restores authoritative answered cards after reload", () => {
    const thread: GraphChatThread = { session_id: "s", graph_id: "g", run_id: "run", codex_thread_id: "native", active_turn_id: null, created_at: "2026-09-06", updated_at: "2026-09-06", messages: [{ ...message, question: { interaction_id: "q", question: "Which?", choices: [], answer: "This", status: "answered" } }], agent_status: "completed", agent_error: null, last_event_id: 22 };
    const state = stateFromThread(empty, thread);
    expect(state.messages[0].question?.answer).toBe("This");
    expect(state.status).toBe("completed");
    expect(state.runId).toBe("run");
  });
  it("keeps failures and interruptions visible", () => {
    const state = reduceAgentEvent(empty, { type: "turn_completed", status: "failed", error: "Connection lost", event_id: 2 });
    expect(state.error).toBe("Connection lost");
    expect(state.status).toBe("failed");
  });
  it("parses split UTF-8 chunks and a final event without newline", async () => {
    const source = new TextEncoder().encode(JSON.stringify({ type: "message", message: { ...message, content: "Привет" } }) + "\n" + JSON.stringify({ type: "turn_completed", status: "completed" }));
    const stream = new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < source.length; i += 3) controller.enqueue(source.slice(i, i + 3)); controller.close(); } });
    const events: GraphChatStreamEvent[] = [];
    await consumeAgentEvents(new Response(stream), (event) => events.push(event));
    expect(events).toHaveLength(2);
    expect(events[0].type === "message" && events[0].message.content).toBe("Привет");
  });
});
