from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.core.config import Settings
from app.models.domain import QuizQuestion
from app.services.quiz_service import QuizService
from app.services.repository import GraphRepository


class QuizServiceTests(unittest.TestCase):
    DEMO_GRAPH_ID = "mathematics-demo"

    def setUp(self) -> None:
        settings = Settings()
        self.quiz_service = QuizService(settings)

    def questions(self):
        return [QuizQuestion(id=f"q{i}", prompt=f"Question {i}?", choices=["A", "B", "C", "D"], correct_choice_index=0) for i in range(6)]

    def test_closure_status_blocks_unfinished_prerequisites(self) -> None:
        repository = self._repository()
        graph = repository.graph(self.DEMO_GRAPH_ID)

        status = self.quiz_service.build_closure_status(graph, "embeddings")

        self.assertIn("linear-algebra", status.prerequisite_topic_ids)
        self.assertNotIn("vectors-geometry", status.prerequisite_topic_ids)
        self.assertNotIn("circles", status.prerequisite_topic_ids)
        self.assertFalse(status.can_award_completion)
        self.assertIn("linear-algebra", status.blocked_prerequisite_ids)

    def test_quiz_attempt_awards_state_only_when_prerequisites_closed(self) -> None:
        repository = self._repository()
        graph = repository.graph(self.DEMO_GRAPH_ID)

        for topic in graph.topics:
            if topic.id in {"arithmetics", "angles", "algebra-basics", "triangles", "functions", "circles", "vectors-geometry", "linear-algebra"}:
                topic.state = "solid"
        session = self.quiz_service.start_session(graph, "embeddings", 6, questions=self.questions(), generator="test-codex")
        answers = {question.id: question.correct_choice_index for question in session.questions}
        attempt, _, awarded_state, _ = self.quiz_service.grade_session(graph, session, answers)

        repository.record_quiz_attempt(self.DEMO_GRAPH_ID, attempt, awarded_state)
        updated = repository.graph(self.DEMO_GRAPH_ID)
        embeddings = next(topic for topic in updated.topics if topic.id == "embeddings")

        self.assertEqual(embeddings.state, "solid")
        self.assertEqual(len(updated.quiz_attempts), 1)
        self.assertTrue(updated.quiz_attempts[0].closure_awarded)

    def test_start_session_blocks_topics_with_open_prerequisites(self) -> None:
        repository = self._repository()
        graph = repository.graph(self.DEMO_GRAPH_ID)

        with self.assertRaises(ValueError) as context:
            self.quiz_service.start_session(graph, "embeddings", 6, questions=self.questions(), generator="test-codex")

        self.assertIn("close prerequisite topics first", str(context.exception))

    def test_failed_attempt_marks_topic_for_review(self) -> None:
        repository = self._repository()
        graph = repository.graph(self.DEMO_GRAPH_ID)
        session = self.quiz_service.start_session(graph, "arithmetics", 6, questions=self.questions(), generator="test-codex")
        wrong_answers = {question.id: (question.correct_choice_index + 1) % len(question.choices) for question in session.questions}
        attempt, _, awarded_state, reviews = self.quiz_service.grade_session(graph, session, wrong_answers)

        repository.record_quiz_attempt(self.DEMO_GRAPH_ID, attempt, awarded_state)
        updated = repository.graph(self.DEMO_GRAPH_ID)
        arithmetics = next(topic for topic in updated.topics if topic.id == "arithmetics")

        self.assertEqual(arithmetics.state, "needs_review")
        self.assertFalse(updated.quiz_attempts[0].passed)
        self.assertEqual(len(reviews), 6)
        self.assertTrue(all(review.correct_choice for review in reviews))

    def test_invalid_question_count_fails_instead_of_truncating(self):
        graph = self._repository().graph(self.DEMO_GRAPH_ID)
        with self.assertRaisesRegex(ValueError, "exactly 6"):
            self.quiz_service.start_session(graph, "arithmetics", 6, questions=self.questions()[:5], generator="test-codex")

    def test_duplicate_questions_are_rejected_without_silent_repair(self):
        graph = self._repository().graph(self.DEMO_GRAPH_ID)
        questions = self.questions()
        questions[1].prompt = questions[0].prompt
        with self.assertRaisesRegex(ValueError, "distinct"):
            self.quiz_service.start_session(graph, "arithmetics", 6, questions=questions, generator="test-codex")

    def _repository(self) -> GraphRepository:
        tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(tempdir.cleanup)
        return GraphRepository(Path(tempdir.name) / "state.sqlite3")


if __name__ == "__main__":
    unittest.main()
