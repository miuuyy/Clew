import { useState } from "react";
import type { AgentQuestion, InlineChatQuiz, TopicQuizSession } from "../../lib/types";
import { renderDisplayText } from "../../lib/appUiHelpers";

export type AgentControls = {
  answer: (interactionId: string, answer?: string, choiceIndex?: number) => Promise<void>;
  stop: () => Promise<void>;
  reconnect: () => void;
  authenticated: boolean;
  connect: () => void;
  openQuiz: (session: TopicQuizSession) => void;
};
export function AgentInteraction({ question, quiz, controls }: {
  question?: AgentQuestion | null; quiz?: InlineChatQuiz | null; controls: AgentControls;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const item = question ?? quiz;
  if (!item) return null;
  const answered = question?.status === "answered" || quiz?.answered_index != null;
  const pending = item.status === "pending" && !!item.interaction_id;
  const send = async (choiceIndex?: number) => {
    if (busy || !pending || !item.interaction_id) return;
    setBusy(true); setError(null);
    try { await controls.answer(item.interaction_id, value || undefined, choiceIndex); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not send your answer."); }
    finally { setBusy(false); }
  };
  return <div className="inlineQuizCard">
    <div className="inlineQuizQuestion">{renderDisplayText(item.question)}</div>
    <div className="inlineQuizChoices">
      {item.choices.map((choice, index) => {
        let className = "inlineQuizChoice";
        if (answered && quiz) className += index === quiz.correct_index ? " inlineQuizCorrect" : index === quiz.answered_index ? " inlineQuizWrong" : " inlineQuizDimmed";
        if (question?.answer === choice) className += " inlineQuizCorrect";
        return <button key={index} className={className} type="button" disabled={!pending || busy || answered} onClick={() => void send(index)}>{renderDisplayText(choice)}</button>;
      })}
    </div>
    {question && pending ? <form className="agentQuestionForm" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <textarea className="textarea textareaCompact" aria-label="Your answer" placeholder={question.choices.length ? "Or write your own answer…" : "Your answer…"} value={value} disabled={busy} maxLength={12000} onChange={(event) => setValue(event.target.value)} />
      <button className="btn btn-sm" type="submit" disabled={busy || !value.trim()}>{busy ? "Sending…" : "Send answer"}</button>
    </form> : null}
    {question?.answer ? <div className="mutedSmall">Your answer: {question.answer}</div> : null}
    {!pending && !answered ? <div className="mutedSmall">This question is closed. Continue the conversation to ask again.</div> : null}
    {error ? <div className="inlineNotice inlineNoticeError" role="alert">{error}</div> : null}
  </div>;
}
