import type { GraphChatState } from "./appContracts";
import type { ChatMessage, GraphChatStreamEvent, GraphChatThread } from "./types";

export const activeAgentStatus = (status?: string) => status === "starting" || status === "running" || status === "waiting";
export function upsertChatMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const index = messages.findIndex((entry) => entry.id === message.id);
  if (index < 0) return [...messages, message];
  return messages.map((entry, position) => position === index ? message : entry);
}
export function stateFromThread(current: GraphChatState, thread: GraphChatThread): GraphChatState {
  return { ...current, messages: thread.messages, sessionId: thread.session_id, runId: thread.run_id, status: thread.agent_status,
    error: thread.agent_error, lastEventId: thread.last_event_id };
}
export function reduceAgentEvent(current: GraphChatState, event: GraphChatStreamEvent): GraphChatState {
  if (event.event_id && event.event_id <= (current.lastEventId ?? 0)) return current;
  let next = current;
  if (event.type === "thread_state") next = stateFromThread(current, event.thread);
  if (event.type === "message") next = { ...current, messages: upsertChatMessage(current.messages, event.message) };
  if (event.type === "turn_status" || event.type === "turn_completed") next = { ...current, status: event.status, error: event.error ?? null };
  return { ...next, sessionId: event.session_id ?? next.sessionId, runId: event.run_id ?? next.runId, lastEventId: event.event_id ?? next.lastEventId };
}
export async function consumeAgentEvents(response: Response, receive: (event: GraphChatStreamEvent) => void): Promise<void> {
  if (!response.body) throw new Error("The chat stream is unavailable.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) receive(JSON.parse(line) as GraphChatStreamEvent);
      if (done) {
        if (buffer.trim()) receive(JSON.parse(buffer) as GraphChatStreamEvent);
        return;
      }
    }
  } finally { reader.releaseLock(); }
}
