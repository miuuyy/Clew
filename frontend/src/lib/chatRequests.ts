import { readErrorMessage } from "./appUiHelpers";
import type { ChatSessionSummary } from "./types";

export type ApiFetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function fetchChatSessions(
  apiFetch: ApiFetchLike,
  requestUrl: string,
  fallbackMessage: string,
): Promise<ChatSessionSummary[]> {
  const response = await apiFetch(requestUrl);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, fallbackMessage));
  }
  return (await response.json()) as ChatSessionSummary[];
}
