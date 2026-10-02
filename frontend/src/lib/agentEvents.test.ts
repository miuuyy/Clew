import { describe, expect, it, vi } from "vitest";
import { consumeAgentEvents, parseChatThread, reduceAgentEvent, stateFromThread } from "./agentEvents";
import type { GraphChatState } from "./appContracts";
import type { GraphChatThread } from "./types";
const thread: GraphChatThread = { graph_id: "g", session_id: "s", run_id: "run", agent_status: "completed", agent_error: null, last_event_id: 5, created_at: "2026-10-02", updated_at: "2026-10-02", messages: [] };
const identity = { event_id: 1, run_id: "run", session_id: "s" };
const response = (body: string) => new Response(body, { headers: { "Content-Type": "application/x-ndjson" } });
describe("agent event contracts", () => {
  it("does not rewind a newer streamed state with an older HTTP snapshot", () => {
    const current: GraphChatState = { input: "draft", messages: [], sessionId: "s", runId: "new", status: "running", lastEventId: 8 };
    expect(stateFromThread(current, thread)).toBe(current);
  });
  it("does not apply events from another conversation or mutate state for heartbeats", () => {
    const current: GraphChatState = { input: "", messages: [], sessionId: "s", runId: "run" };
    expect(reduceAgentEvent(current, { type: "heartbeat" })).toBe(current);
    expect(() => reduceAgentEvent(current, { type: "turn_completed", status: "completed", session_id: "other", event_id: 1 })).toThrow("another conversation");
  });
  it("rejects malformed successful thread responses", () => {
    for (const value of [null, { ...thread, messages: null }, { ...thread, agent_status: "unknown" }, { ...thread, last_event_id: -1 }, { ...thread, topic_id: 123 }]) {
      expect(() => parseChatThread(value)).toThrow("thread is invalid");
    }
  });
  it("rejects scalar events, missing identities, invalid terminal states and unknown event types", async () => {
    for (const value of [null, [], { type: "message", message: null, ...identity },
      { type: "turn_completed", status: "running", ...identity }, { type: "turn_completed", status: "completed" },
      { type: "future_event", ...identity }]) {
      await expect(consumeAgentEvents(response(JSON.stringify(value)), () => {})).rejects.toThrow();
    }
  });
  it("rejects an unexpected successful content type", async () => {
    await expect(consumeAgentEvents(new Response("<html></html>", { headers: { "Content-Type": "text/html" } }), () => {})).rejects.toThrow("NDJSON");
  });
  it("cancels an open stream when a malformed event is received", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("null\n")); }, cancel });
    await expect(consumeAgentEvents(new Response(body, { headers: { "Content-Type": "application/x-ndjson" } }), () => {})).rejects.toThrow("event is invalid");
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });
  it("does not deliver buffered events after cancellation", async () => {
    const abort = new AbortController();
    const receive = vi.fn(() => abort.abort());
    const event = { type: "turn_completed", status: "completed", ...identity };
    await expect(consumeAgentEvents(response(`${JSON.stringify(event)}\n${JSON.stringify({ ...event, event_id: 2 })}\n`), receive, abort.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(receive).toHaveBeenCalledOnce();
  });
  it("rejects invalid UTF-8 instead of replacing corrupted message text", async () => {
    const prefix = new TextEncoder().encode(`{"type":"message","message":{"id":"m","role":"assistant","created_at":"2026-10-02","content":"`);
    const suffix = new TextEncoder().encode(`"},"event_id":1,"run_id":"run","session_id":"s"}\n`);
    const source = new Uint8Array([...prefix, 0xff, ...suffix]);
    const receive = vi.fn();
    await expect(consumeAgentEvents(new Response(source, { headers: { "Content-Type": "application/x-ndjson" } }), receive)).rejects.toThrow();
    expect(receive).not.toHaveBeenCalled();
  });
});
