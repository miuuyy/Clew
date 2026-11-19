import { useState } from "react";
import type { AppCopy } from "../../lib/appCopy";
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
export function AgentInteraction({ question, quiz, controls, copy }: {
  question?: AgentQuestion | null; quiz?: InlineChatQuiz | null; controls: AgentControls; copy: AppCopy;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const item = question ?? quiz;
  if (!item) return null;
  const answered = question?.status === "answered" || quiz?.answered_index != null;
  const pending = !answered && !!item.interaction_id;
  const send = async (choiceIndex?: number) => {
    if (busy || !pending || !item.interaction_id) return;
    setBusy(true); setError(null);
    try { await controls.answer(item.interaction_id, value || undefined, choiceIndex); }
    catch (cause) { setError(copy.errors.request(copy.sessions.answerFailed, cause instanceof Error ? cause.message : "")); }
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
      <textarea className="agentQuestionInput" rows={1} aria-label={copy.sessions.yourAnswer} placeholder={question.choices.length ? copy.sessions.customAnswer : copy.sessions.answerPlaceholder} value={value} disabled={busy} maxLength={12000} onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
      <button className="agentQuestionSend" type="submit" aria-label={copy.sessions.sendAnswer} disabled={busy || !value.trim()}>{busy ? copy.sessions.sending : copy.shell.send}</button>
    </form> : null}
    {question?.answer && !question.choices.includes(question.answer) ? <div className="inlineQuizNote">{copy.quiz.yourAnswer(question.answer)}</div> : null}
    {error ? <div className="inlineQuizNote inlineQuizNoteError" role="alert">{error}</div> : null}
  </div>;
}
