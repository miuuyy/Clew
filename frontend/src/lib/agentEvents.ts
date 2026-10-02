import type { GraphChatState } from "./appContracts";
import type { AgentStatus, ChatMessage, GraphChatStreamEvent, GraphChatThread } from "./types";

const statuses = new Set(["idle", "starting", "running", "waiting", "completed", "interrupted", "failed"]);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const status = (value: unknown): value is AgentStatus => typeof value === "string" && statuses.has(value);
export function parseChatMessage(value: unknown): ChatMessage {
  if (!record(value) || !identifier(value.id) || (value.role !== "user" && value.role !== "assistant")
    || typeof value.content !== "string" || typeof value.created_at !== "string") throw new Error("The chat message is invalid.");
  return value as ChatMessage;
}
export function parseChatThread(value: unknown): GraphChatThread {
  if (!record(value) || !identifier(value.session_id) || !identifier(value.graph_id)
    || (value.topic_id != null && !identifier(value.topic_id))
    || (value.run_id !== null && !identifier(value.run_id)) || !status(value.agent_status)
    || (value.agent_error !== null && typeof value.agent_error !== "string")
    || !Number.isSafeInteger(value.last_event_id) || (value.last_event_id as number) < 0
    || !Array.isArray(value.messages)) throw new Error("The chat thread is invalid.");
  value.messages.forEach(parseChatMessage);
  return value as GraphChatThread;
}
function parseEvent(value: unknown): GraphChatStreamEvent {
  if (!record(value)) throw new Error("The chat stream event is invalid.");
  if (value.type === "heartbeat") return { type: "heartbeat" };
  if (!Number.isSafeInteger(value.event_id) || (value.event_id as number) < 1
    || !identifier(value.session_id) || !identifier(value.run_id)) throw new Error("The chat stream event has no valid replay identity.");
  if (value.type === "thread_state") {
    const thread = parseChatThread(value.thread);
    if (thread.session_id !== value.session_id || thread.run_id !== value.run_id) throw new Error("The chat stream conversation identity is inconsistent.");
  } else if (value.type === "message") parseChatMessage(value.message);
  else if (value.type === "turn_status" || value.type === "turn_completed") {
    if (!status(value.status) || (value.error != null && typeof value.error !== "string")
      || (value.type === "turn_completed" && !["completed", "interrupted", "failed"].includes(value.status))) throw new Error("The chat stream status is invalid.");
  } else throw new Error("The chat stream event type is unsupported.");
  return value as GraphChatStreamEvent;
}

export const activeAgentStatus = (status?: string) => status === "starting" || status === "running" || status === "waiting";
export function upsertChatMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const index = messages.findIndex((entry) => entry.id === message.id);
  if (index < 0) return [...messages, message];
  return messages.map((entry, position) => position === index ? message : entry);
}
export function stateFromThread(current: GraphChatState, thread: GraphChatThread): GraphChatState {
  if (current.sessionId === thread.session_id && thread.last_event_id < (current.lastEventId ?? 0)) return current;
  return { ...current, messages: thread.messages, sessionId: thread.session_id, runId: thread.run_id, status: thread.agent_status,
    error: thread.agent_error, lastEventId: thread.last_event_id };
}
export function reduceAgentEvent(current: GraphChatState, event: GraphChatStreamEvent): GraphChatState {
  if (event.type === "heartbeat") return current;
  if (current.sessionId && event.session_id && current.sessionId !== event.session_id) throw new Error("The chat event belongs to another conversation.");
  if (event.event_id && event.event_id <= (current.lastEventId ?? 0)) return current;
  let next = current;
  if (event.type === "thread_state") next = stateFromThread(current, event.thread);
  if (event.type === "message") next = { ...current, messages: upsertChatMessage(current.messages, event.message) };
  if (event.type === "turn_status" || event.type === "turn_completed") next = { ...current, status: event.status, error: event.error ?? null };
  return { ...next, sessionId: event.session_id ?? next.sessionId, runId: event.run_id ?? next.runId, lastEventId: event.event_id ?? next.lastEventId };
}
export async function consumeAgentEvents(response: Response, receive: (event: GraphChatStreamEvent) => void, signal?: AbortSignal): Promise<void> {
  if (!response.body) throw new Error("The chat stream is unavailable.");
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/x-ndjson" && contentType !== "application/ndjson") throw new Error("The chat response is not an NDJSON stream.");
  signal?.throwIfAborted();
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) {
        signal?.throwIfAborted();
        receive(parseEvent(JSON.parse(line)));
      }
      if (done) {
        if (buffer.trim()) receive(parseEvent(JSON.parse(buffer)));
        return;
      }
    }
  } catch (cause) {
    await reader.cancel().catch(() => {});
    throw cause;
  } finally { signal?.removeEventListener("abort", abort); reader.releaseLock(); }
}
