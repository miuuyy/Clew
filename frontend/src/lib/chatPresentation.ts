import type { ChatMessage } from "./types";

export type ChatReply = {
  id: string;
  role: ChatMessage["role"];
  messages: ChatMessage[];
};

/** Keep native item identity for actions/replay while presenting one reply per turn. */
export function groupChatReplies(messages: ChatMessage[]): ChatReply[] {
  const replies: ChatReply[] = [];
  for (const message of messages) {
    if (message.hidden) continue;
    const id = message.role === "assistant" && message.reply_id ? message.reply_id : message.id;
    const previous = replies[replies.length - 1];
    if (message.role === "assistant" && message.reply_id && previous?.role === "assistant" && previous.id === id) {
      previous.messages.push(message);
    } else {
      replies.push({ id, role: message.role, messages: [message] });
    }
  }
  return replies;
}

export function presentChatReply(reply: ChatReply, active: boolean, waiting: boolean) {
  const completeText = (message: ChatMessage) => !!message.content && message.agent_status !== "streaming";
  const texts = reply.messages.filter((message) => completeText(message) && message.message_phase !== "commentary");
  // Typed Codex commentary updates one status, never a transcript of internal steps.
  // An unknown phase is normal text; do not classify its meaning using keywords.
  const commentary = reply.messages.filter((message) => completeText(message) && message.message_phase === "commentary").at(-1);
  const progress = active && !waiting;
  const activeTool = reply.messages.filter((message) => message.activity?.status === "running").at(-1)?.activity;
  const progressLabel = activeTool && ["propose_ingest", "propose_expand", "create_closure_quiz"].includes(activeTool.tool)
    ? activeTool.detail : "Working…";
  const cards = reply.messages.filter((message) =>
    message.proposal || message.question || message.inline_quiz || message.closure_quiz
    || message.planning_status || message.planning_error || message.activity?.status === "failed",
  );
  return {
    texts,
    cards,
    commentary: !texts.length ? commentary?.content ?? null : null,
    progress,
    progressLabel,
    interrupted: reply.messages.some((message) => message.agent_status === "interrupted"),
  };
}
