import { readErrorMessage } from "./apiRequest";
import type { ChatSessionSummary } from "./types";

export type ApiFetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function fetchChatSessions(
  apiFetch: ApiFetchLike,
  requestUrl: string,
  fallbackMessage: string,
  init?: RequestInit,
): Promise<ChatSessionSummary[]> {
  const response = await apiFetch(requestUrl, init);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, fallbackMessage));
  }
  const result: unknown = await response.json();
  const ids = new Set<string>();
  if (!Array.isArray(result) || result.some((value) => {
    if (!value || typeof value !== "object" || typeof value.session_id !== "string" || !value.session_id
      || typeof value.graph_id !== "string" || !value.graph_id || typeof value.created_at !== "string"
      || typeof value.updated_at !== "string" || !Number.isSafeInteger(value.message_count) || value.message_count < 0
      || ids.has(value.session_id)) return true;
    ids.add(value.session_id);
    return false;
  })) throw new Error("The chat session list is invalid.");
  return result as ChatSessionSummary[];
}
