import { describe, expect, it } from "vitest";
import { groupChatReplies, presentChatReply } from "./chatPresentation";
import type { ChatMessage } from "./types";

const part = (id: string, patch: Partial<ChatMessage> = {}): ChatMessage => ({
  id, role: "assistant", reply_id: "run", content: "", created_at: "2026-09-06T00:00:00Z", ...patch,
});
const view = (messages: ChatMessage[], active = false, waiting = false) =>
  presentChatReply(groupChatReplies(messages)[0], active, waiting);

describe("Clew reply presentation", () => {
  it("nests native items in their turn without merging separate turns or old messages", () => {
    const groups = groupChatReplies([
      part("legacy", { reply_id: null, content: "Old answer" }),
      part("user", { role: "user", content: "Help" }),
      part("preamble", { content: "Preparing", message_phase: "commentary" }),
      part("tool"), part("final", { content: "Ready" }),
      part("hidden-user", { role: "user", hidden: true }),
      part("next", { reply_id: "next-run", content: "Next answer" }),
    ]);
    expect(groups.map((group) => group.id)).toEqual(["legacy", "user", "run", "next-run"]);
    expect(groups[2].messages.map((message) => message.id)).toEqual(["preamble", "tool", "final"]);
  });

  it("buffers token deltas and reveals the completed message", () => {
    const streaming = part("text", { content: "An unfinished", agent_status: "streaming" });
    expect(view([streaming], true).texts).toHaveLength(0);
    expect(view([{ ...streaming, content: "An unfinished thought, now complete.", agent_status: "completed" }]).texts[0].content).toBe("An unfinished thought, now complete.");
  });

  it("updates a single preamble, then replaces it with the answer", () => {
    const parts = [part("first", { content: "Starting", message_phase: "commentary" }), part("next", { content: "Preparing", message_phase: "commentary" })];
    expect(view(parts, true).commentary).toBe("Preparing");
    expect(view(parts, true).texts).toHaveLength(0);
    const final = view([...parts, part("final", { content: "Ready", message_phase: "final_answer" })]);
    expect(final.commentary).toBeNull();
    expect(final.texts.map((message) => message.content)).toEqual(["Ready"]);
  });

  it("keeps unknown-phase text and stopped partial text instead of guessing their meaning", () => {
    expect(view([part("unknown", { content: "I will read your graph." })]).texts).toHaveLength(1);
    const stopped = view([part("partial", { content: "Partial answer", agent_status: "interrupted" })]);
    expect(stopped.texts[0].content).toBe("Partial answer");
    expect(stopped.interrupted).toBe(true);
  });

  it("keeps completed reads out of the conversation but surfaces tool failures", () => {
    const read = part("read", { activity: { id: "call", tool: "read_graph", status: "completed", detail: "Reading your graph" } });
    expect(view([read]).cards).toHaveLength(0);
    expect(view([read]).progress).toBe(false);
    expect(view([{ ...read, activity: { ...read.activity!, status: "failed", detail: "Graph not found" } }]).cards[0].activity?.detail).toBe("Graph not found");
  });

  it("keeps multiple tool card identities and stops the loader while awaiting input", () => {
    const parts = [part("question", { question: { interaction_id: "q", question: "Which?", choices: ["A", "B"], status: "pending" } }),
      part("quiz", { inline_quiz: { interaction_id: "quiz", question: "How many?", choices: ["1", "2", "3", "4"], correct_index: 1, status: "pending" } })];
    expect(view(parts, true, true).cards.map((message) => message.id)).toEqual(["question", "quiz"]);
    expect(view(parts, true, true).progress).toBe(false);
    expect(view(parts, true, false).progress).toBe(true);
  });
});
