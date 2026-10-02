// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../lib/apiRequest";
import type { ChatMessage, GraphChatThread, GraphEnvelope } from "../lib/types";
import { useGraphChatController } from "./useGraphChatController";

vi.mock("../lib/apiRequest", async (original) => ({ ...await original<typeof import("../lib/apiRequest")>(), apiFetch: vi.fn() }));
const request = vi.mocked(apiFetch);
const graph = { graph_id: "g", subject: "test", title: "Test", language: "en", version: 1, topics: [], edges: [], zones: [], quiz_attempts: [], metadata: {} } as GraphEnvelope;
const message = (id: string, content: string): ChatMessage => ({ id, role: "assistant", content, created_at: "2026-10-02T00:00:00Z" });
const thread = (values: Partial<GraphChatThread> = {}): GraphChatThread => ({ graph_id: "g", session_id: "s", run_id: null, agent_status: "idle", agent_error: null, last_event_id: 0, created_at: "2026-10-02", updated_at: "2026-10-02", messages: [], ...values });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const events = (values: unknown[]) => new Response(values.map((value) => JSON.stringify(value)).join("\n"), { headers: { "Content-Type": "application/x-ndjson" } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
let root: Root;
let controller: ReturnType<typeof useGraphChatController>;
function Harness({ activeGraph = graph, selectedTopicId = null }: { activeGraph?: GraphEnvelope; selectedTopicId?: string | null }) {
  controller = useGraphChatController({ activeGraph, selectedTopicId, selectedChatModel: "chosen", defaultModel: null, loadChatError: "Chat failed", loadChatSessionsError: "Sessions failed" });
  return null;
}
async function mount() { await act(async () => root.render(<Harness />)); }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  request.mockReset();
  request.mockImplementation(async (url) => json(String(url).endsWith("/sessions") ? [] : thread()));
  root = createRoot(document.createElement("div"));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

describe("graph chat lifecycle", () => {
  it("keeps graph names that match object prototypes scoped while loading", async () => {
    request.mockImplementation(() => new Promise<Response>(() => {}));
    await act(async () => root.render(<Harness activeGraph={{ ...graph, graph_id: "constructor" }} />));
    expect(controller.chatSessions).toEqual([]);
    expect(controller.chatSessionsError).toBeNull();
  });
  it("does not leave thread loading stuck after a send replaces the initial request", async () => {
    const initial = deferred<Response>();
    request.mockImplementation(async (url) => String(url).endsWith("/sessions") ? json([]) : String(url).endsWith("/stream") ? json({ detail: "Rejected" }, 400) : initial.promise);
    await mount();
    expect(controller.chatThreadLoading).toBe(true);
    await act(async () => { await controller.sendChat("hello"); });
    expect(controller.chatThreadLoading).toBe(false);
    expect(controller.currentChatState.input).toBe("hello");
    expect(controller.chatError).toBe("Rejected");
  });

  it("does not replace a newly typed draft when a pending send is rejected", async () => {
    await mount();
    const pending = deferred<Response>();
    request.mockReturnValueOnce(pending.promise);
    let send!: Promise<void>;
    await act(async () => { send = controller.sendChat("First prompt"); });
    await act(async () => { controller.updateCurrentChatState((current) => ({ ...current, input: "My next draft" })); });
    await act(async () => { pending.resolve(json({ detail: "Rejected" }, 400)); await send; });
    expect(controller.currentChatState.input).toBe("My next draft");
  });

  it("does not clear or expose composer drafts for hidden button requests", async () => {
    await mount();
    await act(async () => { controller.updateCurrentChatState((current) => ({ ...current, input: "My draft" })); });
    const pending = deferred<Response>();
    request.mockReturnValueOnce(pending.promise);
    let send!: Promise<void>;
    await act(async () => { send = controller.sendChat("Internal quiz prompt", { hiddenUserMessage: true }); });
    expect(controller.currentChatState.input).toBe("My draft");
    await act(async () => { pending.resolve(json({ detail: "Rejected" }, 400)); await send; });
    expect(controller.currentChatState.input).toBe("My draft");
    expect(controller.currentChatState.messages).toEqual([]);
  });

  it("does not let overlapping session refreshes replace the newer list", async () => {
    await mount();
    const first = deferred<Response>();
    const second = deferred<Response>();
    request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    let a!: Promise<void>, b!: Promise<void>;
    await act(async () => { a = controller.loadSessions(); b = controller.loadSessions(); });
    const session = (id: string) => ({ session_id: id, graph_id: "g", topic_id: null, title: null, created_at: "2026-10-02", updated_at: "2026-10-02", message_count: 0 });
    await act(async () => { second.resolve(json([session("new")])); await b; });
    await act(async () => { first.resolve(json([session("old")])); await a; });
    expect(controller.chatSessions.map((item) => item.session_id)).toEqual(["new"]);
  });

  it("clearing a graph invalidates its delayed send and releases its busy marker", async () => {
    await mount();
    const old = deferred<Response>();
    request.mockImplementation(async (url) => String(url).endsWith("/sessions") ? json([]) : String(url).endsWith("/stream") ? old.promise : json(thread()));
    let stale!: Promise<void>;
    await act(async () => { stale = controller.sendChat("old prompt"); });
    await act(async () => { controller.clearChatStateForGraph("g"); });
    request.mockImplementation(async (url) => String(url).endsWith("/sessions") ? json([]) : String(url).endsWith("/stream") ? events([
      { type: "thread_state", thread: thread({ run_id: "new", agent_status: "starting" }), session_id: "s", run_id: "new", event_id: 1 },
      { type: "message", message: message("new", "New reply"), session_id: "s", run_id: "new", event_id: 2 },
      { type: "turn_completed", status: "completed", session_id: "s", run_id: "new", event_id: 3 },
    ]) : json(thread()));
    await act(async () => { await controller.sendChat("new prompt"); });
    await act(async () => {
      old.resolve(events([{ type: "thread_state", thread: thread({ messages: [message("old", "Old reply")], run_id: "old", agent_status: "completed" }), session_id: "s", run_id: "old", event_id: 99 }]));
      await stale;
    });
    expect(controller.currentChatState.messages.map((item) => item.content)).toContain("New reply");
    expect(controller.currentChatState.messages.map((item) => item.content)).not.toContain("Old reply");
  });

  it("a delayed answer acknowledgement cannot overwrite a completed streamed card", async () => {
    const card: ChatMessage = { ...message("card", ""), question: { interaction_id: "q", question: "Which?", choices: [], status: "pending" }, activity: { id: "call", tool: "ask_question", status: "running", detail: "Waiting" } };
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(value) { stream = value; } });
    const ack = deferred<Response>();
    request.mockImplementation(async (url) => String(url).endsWith("/sessions") ? json([]) : String(url).includes("/events?") ? new Response(body, { headers: { "Content-Type": "application/x-ndjson" } }) : String(url).endsWith("/answer") ? ack.promise : json(thread({ run_id: "run", agent_status: "waiting", messages: [card], last_event_id: 1 })));
    await mount();
    let answer!: Promise<void>;
    await act(async () => { answer = controller.answerInteraction("q", "This"); });
    const completed: ChatMessage = { ...card, question: { ...card.question!, status: "answered", answer: "This" }, activity: { ...card.activity!, status: "completed" } };
    await act(async () => {
      stream.enqueue(new TextEncoder().encode(JSON.stringify({ type: "message", message: completed, event_id: 2, session_id: "s", run_id: "run" }) + "\n"));
    });
    await act(async () => { ack.resolve(json({ message: { ...completed, activity: card.activity } })); await answer; });
    expect(controller.currentChatState.messages[0].activity?.status).toBe("completed");
  });

  it("does not let a delayed stop snapshot rewind a newer turn", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(value) { stream = value; } });
    const stopped = deferred<Response>();
    request.mockImplementation(async (url) => String(url).endsWith("/sessions") ? json([]) : String(url).includes("/events?") ? new Response(body, { headers: { "Content-Type": "application/x-ndjson" } }) : String(url).endsWith("/interrupt") ? stopped.promise : String(url).endsWith("/stream") ? events([
      { type: "thread_state", thread: thread({ run_id: "new", agent_status: "starting", last_event_id: 2 }), event_id: 3, session_id: "s", run_id: "new" },
      { type: "message", message: message("new", "New reply"), event_id: 4, session_id: "s", run_id: "new" },
      { type: "turn_completed", status: "completed", event_id: 5, session_id: "s", run_id: "new" },
    ]) : json(thread({ run_id: "old", agent_status: "running", last_event_id: 1 })));
    await mount();
    let stop!: Promise<void>;
    await act(async () => { stop = controller.stopChat(); });
    await act(async () => { stream.enqueue(new TextEncoder().encode(JSON.stringify({ type: "turn_completed", status: "completed", event_id: 2, session_id: "s", run_id: "old" }) + "\n")); stream.close(); });
    await act(async () => { await controller.sendChat("next"); });
    await act(async () => { stopped.resolve(json(thread({ run_id: "old", agent_status: "interrupted", last_event_id: 2 }))); await stop; });
    expect(controller.currentChatState.runId).toBe("new");
    expect(controller.currentChatState.lastEventId).toBe(5);
    expect(controller.currentChatState.messages.at(-1)?.content).toBe("New reply");
  });

  it("an invalid stored conversation produces an explicit error without selecting a different one", async () => {
    localStorage.setItem("knowledge_graph_active_chat_session_v1:g", "missing");
    request.mockImplementation(async (url) => String(url).endsWith("/sessions") ? json([]) : json({ detail: "Chat session not found" }, 404));
    await mount();
    expect(controller.activeSessionId).toBe("missing");
    expect(controller.chatError).toBe("Chat session not found");
    expect(controller.chatThreadLoading).toBe(false);
  });

  it("keeps the loaded conversation topic when its session list is delayed", async () => {
    localStorage.setItem("knowledge_graph_active_chat_session_v1:g", "s");
    request.mockImplementation(async (url) => String(url).endsWith("/sessions") ? new Promise<Response>(() => {}) : String(url).endsWith("/stream") ? events([
      { type: "thread_state", thread: thread({ topic_id: "bound-topic", run_id: "run", agent_status: "starting" }), session_id: "s", run_id: "run", event_id: 1 },
      { type: "turn_completed", status: "completed", session_id: "s", run_id: "run", event_id: 2 },
    ]) : json(thread({ topic_id: "bound-topic" })));
    await act(async () => root.render(<Harness selectedTopicId="unrelated-topic" />));
    await act(async () => { await controller.sendChat("Continue"); });
    const sent = request.mock.calls.find(([url]) => String(url).endsWith("/stream"))!;
    expect(JSON.parse(sent[1]!.body as string)).toMatchObject({ selected_topic_id: "bound-topic", session_id: "s", model: "chosen" });
  });

  it("does not send an unloaded saved conversation using another topic's context", async () => {
    localStorage.setItem("knowledge_graph_active_chat_session_v1:g", "s");
    request.mockImplementation(() => new Promise<Response>(() => {}));
    await act(async () => root.render(<Harness selectedTopicId="unrelated-topic" />));
    await act(async () => { await controller.sendChat("Continue"); });
    expect(request.mock.calls.some(([url]) => String(url).endsWith("/stream"))).toBe(false);
    expect(controller.chatError).toContain("Conversation is still loading");
    expect(controller.currentChatState.messages).toEqual([]);
  });

  it("rejects a streamed snapshot for another graph", async () => {
    await mount();
    request.mockImplementation(async (url) => String(url).endsWith("/sessions") ? json([]) : events([
      { type: "thread_state", thread: thread({ graph_id: "other", run_id: "run", agent_status: "running", messages: [message("wrong", "Wrong graph")] }), session_id: "s", run_id: "run", event_id: 1 },
    ]));
    await act(async () => { await controller.sendChat("Continue"); });
    expect(controller.chatError).toContain("another graph");
    expect(controller.currentChatState.messages.some((item) => item.content === "Wrong graph")).toBe(false);
  });
});
