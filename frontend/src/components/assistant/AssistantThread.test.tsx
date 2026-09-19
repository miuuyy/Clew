import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { APP_COPY } from "../../lib/appCopy";
import type { GraphChatState } from "../../lib/appContracts";
import type { ChatMessage } from "../../lib/types";
import { AssistantThread } from "./AssistantThread";

const part = (id: string, patch: Partial<ChatMessage> = {}): ChatMessage => ({
  id, role: "assistant", reply_id: "run", content: "", created_at: "2026-09-06T00:00:00Z", ...patch,
});
function render(messages: ChatMessage[], status: GraphChatState["status"] = "completed", runId: string | null = "run") {
  return renderToStaticMarkup(<AssistantThread copy={APP_COPY}
    agentControls={{ answer: async () => {}, stop: async () => {}, reconnect: () => {}, authenticated: true, connect: () => {}, openQuiz: () => {} }}
    chatViewportRef={createRef()} chatComposerRef={createRef()} chatThreadLoading={false}
    currentChatState={{ messages, input: "", status, runId }} visibleMessages={messages}
    chatLoading={["starting", "running", "waiting"].includes(status!)} hasInlinePlanningWidget={false}
    applyLoadingMessageId={null} applyProposalFromMessage={async () => {}} updateCurrentChatState={() => {}} />);
}

describe("nested assistant reply", () => {
  it("renders the answer above its interactive card in one bubble, without a tool transcript", () => {
    const html = render([
      part("preface", { content: "I am reading", message_phase: "commentary" }),
      part("read", { activity: { id: "read", tool: "read_graph", status: "completed", detail: "Reading your graph" } }),
      part("question", { question: { interaction_id: "q", question: "Which example?", choices: ["A", "B"], status: "answered", answer: "A" } }),
      part("final", { content: "Here is the explanation.", message_phase: "final_answer" }),
    ]);
    expect(html.match(/chatMessage-assistant/g)).toHaveLength(1);
    expect(html.indexOf("Here is the explanation.")).toBeLessThan(html.indexOf("Which example?"));
    expect(html).not.toContain("I am reading");
    expect(html).not.toContain("Reading your graph");
    expect(html).not.toContain("chatTypingDot");
  });

  it("uses one nested generation status and keeps partial text out of the DOM", () => {
    const html = render([part("partial", { content: "Not complete yet", agent_status: "streaming" }),
      part("tool", { activity: { id: "call", tool: "propose_expand", status: "running", detail: "Preparing a graph proposal" } })], "running");
    expect(html.match(/chatMessage-assistant/g)).toHaveLength(1);
    expect(html).toContain("proposalInlinePending");
    expect(html).toContain("Preparing a graph proposal");
    expect(html).not.toContain("Not complete yet");
    expect(html).not.toContain("chatTypingDot");
  });

  it("does not leave a spinner under a pending question", () => {
    const html = render([part("question", { question: { interaction_id: "q", question: "Which?", choices: [], status: "pending" } })], "waiting");
    expect(html).toContain("Send answer");
    expect(html).not.toContain("proposalInlinePending");
    expect(html).not.toContain("chatTypingDot");
  });

  it("starts a fresh pending reply for hidden button requests without reopening the old reply", () => {
    const html = render([part("old", { reply_id: "old-run", content: "Previous answer" }),
      part("hidden", { role: "user", hidden: true, content: "Button request" })], "starting", null);
    expect(html.match(/chatMessage-assistant/g)).toHaveLength(2);
    expect(html).toContain("chatBubbleLoading");
    expect(html).not.toContain("proposalInlinePending");
    expect(html).not.toContain("Button request");
  });
});
