from __future__ import annotations
from uuid import uuid4

from app.core.config import Settings
from app.models.domain import (
    QuizAttempt,
    QuizQuestion,
    QuizQuestionReview,
    StudyGraph,
    Topic,
    TopicClosureStatus,
    TopicQuizSession,
)


def is_prerequisite_relation(relation: str) -> bool:
    return relation == "requires"


class QuizService:
    def __init__(self, settings: Settings):
        self._settings = settings

    def build_closure_status(self, graph: StudyGraph, topic_id: str) -> TopicClosureStatus:
        topic_map = {topic.id: topic for topic in graph.topics}
        topic = topic_map.get(topic_id)
        if topic is None:
            raise KeyError(topic_id)

        parent_map: dict[str, list[str]] = {item.id: [] for item in graph.topics}
        for edge in graph.edges:
            if not is_prerequisite_relation(edge.relation):
                continue
            parent_map.setdefault(edge.target_topic_id, []).append(edge.source_topic_id)

        prerequisite_ids: list[str] = []
        seen: set[str] = set()
        stack = list(parent_map.get(topic_id, []))
        while stack:
            current = stack.pop()
            if current in seen:
                continue
            seen.add(current)
            prerequisite_ids.append(current)
            stack.extend(parent_map.get(current, []))

        blocked_ids = [
            prerequisite_id
            for prerequisite_id in prerequisite_ids
            if topic_map[prerequisite_id].state not in {"solid", "mastered"}
        ]
        latest_attempt = None
        for attempt in graph.quiz_attempts:
            if attempt.topic_id == topic_id:
                latest_attempt = attempt

        return TopicClosureStatus(
            topic_id=topic.id,
            prerequisite_topic_ids=prerequisite_ids,
            blocked_prerequisite_ids=blocked_ids,
            can_award_completion=len(blocked_ids) == 0,
            latest_attempt=latest_attempt,
        )

    def start_session(self, graph: StudyGraph, topic_id: str, question_count: int, *, questions: list[QuizQuestion], generator: str) -> TopicQuizSession:
        topic_map = {topic.id: topic for topic in graph.topics}
        topic = topic_map.get(topic_id)
        if topic is None:
            raise KeyError(topic_id)
        if question_count < 6 or question_count > 12:
            raise ValueError("question_count must be between 6 and 12")

        closure = self.build_closure_status(graph, topic_id)
        if not closure.can_award_completion:
            blocked_titles = [topic_map[item_id].title for item_id in closure.blocked_prerequisite_ids if item_id in topic_map]
            detail = ", ".join(blocked_titles[:6]) or "open prerequisites"
            raise ValueError(f"close prerequisite topics first: {detail}")
        questions = self._validate_ai_questions(questions, question_count)
        return TopicQuizSession(
            session_id=f"quiz_{uuid4().hex[:12]}",
            graph_id=graph.graph_id,
            topic_id=topic_id,
            question_count=len(questions),
            questions=questions,
            closure_status=closure,
            generator=generator,
        )

    def grade_session(
        self,
        graph: StudyGraph,
        session: TopicQuizSession,
        answers: dict[str, int],
        *,
        pass_threshold: float | None = None,
    ) -> tuple[QuizAttempt, TopicClosureStatus, str | None, list[QuizQuestionReview]]:
        correct_count = 0
        reviews: list[QuizQuestionReview] = []
        for question in session.questions:
            selected_index = answers.get(question.id)
            was_correct = selected_index == question.correct_choice_index
            if was_correct:
                correct_count += 1
            reviews.append(
                QuizQuestionReview(
                    question_id=question.id,
                    prompt=question.prompt,
                    selected_choice=question.choices[selected_index] if selected_index is not None and 0 <= selected_index < len(question.choices) else None,
                    correct_choice=question.choices[question.correct_choice_index],
                    was_correct=was_correct,
                    explanation=question.explanation,
                )
            )
        score = correct_count / max(1, len(session.questions))
        closure = self.build_closure_status(graph, session.topic_id)
        passed = score >= (pass_threshold if pass_threshold is not None else topic_pass_threshold(graph, session.topic_id))
        closure_awarded = passed and closure.can_award_completion
        awarded_state = "solid" if closure_awarded else ("needs_review" if not passed else None)
        missed = [r.prompt for r in reviews if not r.was_correct]
        previous_fails = sum(1 for a in graph.quiz_attempts if a.topic_id == session.topic_id and not a.passed)
        attempt = QuizAttempt(
            id=f"attempt_{uuid4().hex[:12]}",
            topic_id=session.topic_id,
            passed=passed,
            score=score,
            question_count=len(session.questions),
            closure_awarded=closure_awarded,
            missed_questions=missed,
            fail_count=previous_fails + (0 if passed else 1),
        )
        return attempt, closure, awarded_state, reviews

    def _validate_ai_questions(self, questions: list[QuizQuestion], question_count: int) -> list[QuizQuestion]:
        if len(questions) != question_count:
            raise ValueError(f"Expected exactly {question_count} quiz questions; received {len(questions)}.")
        prompts: set[str] = set()
        ids: set[str] = set()
        for question in questions:
            prompt = question.prompt.strip().casefold()
            if not prompt or prompt in prompts or question.id in ids:
                raise ValueError("Quiz questions require distinct nonempty prompts and ids.")
            choices = [choice.strip().casefold() for choice in question.choices]
            if len(choices) != 4 or len(set(choices)) != 4 or not all(choices):
                raise ValueError("Every quiz question requires four distinct nonempty choices.")
            if not 0 <= question.correct_choice_index < 4:
                raise ValueError("Quiz correct_choice_index is out of range.")
            prompts.add(prompt)
            ids.add(question.id)
        return questions


def topic_pass_threshold(graph: StudyGraph, topic_id: str) -> float:
    for topic in graph.topics:
        if topic.id == topic_id:
            return topic.quiz_policy.pass_threshold
    return 0.75
