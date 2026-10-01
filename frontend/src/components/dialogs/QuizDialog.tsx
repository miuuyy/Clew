import React from "react";

import { Modal } from "../ui/Modal";

import type { AppCopy } from "../../lib/appCopy";
import { renderDisplayText } from "../../lib/appUiHelpers";
import type { QuizQuestionReview, Topic, TopicQuizSession } from "../../lib/types";

export function QuizDialog({
  session,
  modalRef,
  closeButtonRef,
  selectedTopic,
  closeModal,
  error,
  reviews,
  answers,
  setAnswers,
  loading,
  submitQuiz,
  copy,
}: {
  session: TopicQuizSession | null;
  modalRef: React.RefObject<HTMLDivElement | null>;
  closeButtonRef: React.RefObject<HTMLButtonElement | null>;
  selectedTopic: Topic | null;
  closeModal: () => void;
  error: string | null;
  reviews: QuizQuestionReview[] | null;
  answers: Record<string, number>;
  setAnswers: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  loading: boolean;
  submitQuiz: () => Promise<void>;
  copy: AppCopy;
}): React.JSX.Element | null {
  if (!session) return null;

  const answered = Object.keys(answers).length;
  return (
    <Modal
      id="quiz-dialog"
      modalRef={modalRef}
      closeButtonRef={closeButtonRef}
      title={copy.quiz.title}
      description={selectedTopic?.title ?? copy.quiz.selectedTopic}
      closeLabel={copy.quiz.closeQuiz}
      onClose={closeModal}
      size="lg"
      footer={reviews ? undefined : <>
        <span className="uiModalFooterStart uiHelp">{answered} / {session.questions.length} · {session.generator}</span>
        <button className="uiButton uiButtonPrimary" disabled={loading} onClick={() => void submitQuiz()} type="button">
          {loading ? copy.quiz.submitting : copy.quiz.submit}
        </button>
      </>}
    >
      {error ? <div className="inlineNotice inlineNoticeError">{error}</div> : null}
      {reviews ? (
        <ol className="quizList">
          {reviews.map((review) => (
            <li key={review.question_id} className="quizItem">
              <div className="quizPrompt">{renderDisplayText(review.prompt)}</div>
              <div className={`quizVerdict ${review.was_correct ? "quizVerdictGood" : "quizVerdictBad"}`}>
                {review.was_correct ? copy.quiz.correct : copy.quiz.incorrect} · {renderDisplayText(copy.quiz.correctAnswer(review.correct_choice))}
              </div>
              {!review.was_correct && review.selected_choice ? <div className="quizNote">{renderDisplayText(copy.quiz.yourAnswer(review.selected_choice))}</div> : null}
              {review.explanation ? <div className="quizNote">{renderDisplayText(review.explanation)}</div> : null}
            </li>
          ))}
        </ol>
      ) : (
        <ol className="quizList">
          {session.questions.map((question) => (
            <li key={question.id} className="quizItem">
              <div className="quizPrompt">{renderDisplayText(question.prompt)}</div>
              <div className="quizChoices">
                {question.choices.map((choice: string, index: number) => (
                  <button
                    key={`${question.id}-${index}`}
                    className={answers[question.id] === index ? "quizChoice quizChoiceSelected" : "quizChoice"}
                    onClick={() => setAnswers((current) => ({ ...current, [question.id]: index }))}
                    type="button"
                    aria-pressed={answers[question.id] === index}
                  >
                    {renderDisplayText(choice)}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
