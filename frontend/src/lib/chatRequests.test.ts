import { describe, expect, it, vi } from "vitest";

import { fetchChatSessions } from "./chatRequests";
import type { ChatSessionSummary } from "./types";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("fetchChatSessions", () => {
  it("returns chat sessions when the request succeeds", async () => {
    const sessions: ChatSessionSummary[] = [
      {
        session_id: "session_1",
        graph_id: "graph_1",
        topic_id: "topic_1",
        title: "Linear algebra",
        created_at: "2026-04-02T08:00:00Z",
        updated_at: "2026-04-02T08:05:00Z",
        message_count: 3,
      },
    ];
    const apiFetch = vi.fn().mockResolvedValue(jsonResponse(sessions, { status: 200 }));

    await expect(fetchChatSessions(apiFetch, "/sessions", "Failed to load chat sessions")).resolves.toEqual(sessions);
  });

  it("surfaces the backend detail when chat sessions fail to load", async () => {
    const apiFetch = vi.fn().mockResolvedValue(
      jsonResponse({ detail: "session storage unavailable" }, { status: 503 }),
    );

    await expect(fetchChatSessions(apiFetch, "/sessions", "Failed to load chat sessions")).rejects.toThrow(
      "session storage unavailable",
    );
  });
});
