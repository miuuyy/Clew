from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.models.api import ObsidianExportOptions
from app.models.domain import Artifact, CreateGraphRequest, GraphProposal, PatchOperation, ProposalTopic, ProposalZone, QuizAttempt, ResourceLink
from app.services.assessment_service import AssessmentService
from app.services.repository import GraphRepository


class RepositoryGraphTests(unittest.TestCase):
    def setUp(self) -> None:
        tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(tempdir.cleanup)
        self.repository = GraphRepository(Path(tempdir.name) / "state.sqlite3")

    def test_create_graph_adds_new_subject_graph(self) -> None:
        workspace = self.repository.create_graph(
            CreateGraphRequest(
                title="Computer Engineering",
                subject="engineering",
                language="uk",
                description="First-year topics",
            )
        )

        self.assertEqual(workspace.workspace.active_graph_id, "computer-engineering")
        created = next(graph for graph in workspace.workspace.graphs if graph.graph_id == "computer-engineering")
        self.assertEqual(created.title, "Computer Engineering")
        self.assertEqual(created.subject, "engineering")
        self.assertEqual(created.language, "uk")
        self.assertEqual(created.metadata["description"], "First-year topics")

    def test_repository_cache_refreshes_after_external_snapshot_write(self) -> None:
        self.repository.current()
        second_repository = GraphRepository(self.repository._db_path)  # noqa: SLF001
        second_repository.create_graph(CreateGraphRequest(title="External Graph", subject="math"))

        graph = self.repository.graph("external-graph")

        self.assertEqual(graph.title, "External Graph")

    def test_repository_waits_for_short_lived_sqlite_writer_contention(self) -> None:
        with self.repository._connect() as conn:  # noqa: SLF001
            busy_timeout_ms = conn.execute("PRAGMA busy_timeout").fetchone()[0]

        self.assertEqual(busy_timeout_ms, 30_000)

    def test_delete_last_graph_leaves_empty_workspace(self) -> None:
        workspace = self.repository.delete_graph("mathematics-demo")

        self.assertEqual(workspace.workspace.graphs, [])
        self.assertIsNone(workspace.workspace.active_graph_id)

    def test_mark_topic_finished_records_perfect_attempt(self) -> None:
        workspace = self.repository.mark_topic_finished("mathematics-demo", "functions")

        graph = next(graph for graph in workspace.workspace.graphs if graph.graph_id == "mathematics-demo")
        topic = next(topic for topic in graph.topics if topic.id == "functions")
        prerequisite = next(topic for topic in graph.topics if topic.id == "algebra-basics")
        attempt = next(item for item in graph.quiz_attempts if item.topic_id == "functions")
        prerequisite_attempt = next(item for item in graph.quiz_attempts if item.topic_id == "algebra-basics")
        self.assertEqual(topic.state, "solid")
        self.assertEqual(prerequisite.state, "solid")
        self.assertTrue(attempt.passed)
        self.assertTrue(prerequisite_attempt.passed)
        self.assertEqual(attempt.score, 1.0)
        self.assertTrue(attempt.closure_awarded)
        self.assertTrue(prerequisite_attempt.closure_awarded)

    def test_update_graph_layout_marks_manual_layout_version(self) -> None:
        workspace = self.repository.update_graph_layout(
            "mathematics-demo",
            {"functions": {"x": 120.0, "y": 240.0}},
        )

        graph = next(graph for graph in workspace.workspace.graphs if graph.graph_id == "mathematics-demo")
        self.assertEqual(graph.metadata["manual_layout_version"], 2)
        self.assertEqual(graph.metadata["manual_layout_positions"]["functions"], {"x": 120.0, "y": 240.0})

    def test_assessment_for_empty_graph_warns(self) -> None:
        workspace = self.repository.create_graph(CreateGraphRequest(title="Physics", subject="science"))
        graph = next(graph for graph in workspace.workspace.graphs if graph.graph_id == "physics")

        assessment = AssessmentService().assess_graph(graph)

        self.assertEqual(assessment.cards[0].value, "Empty graph")
        self.assertEqual(assessment.cards[0].tone, "warn")

    def test_export_graph_package_can_strip_progress(self) -> None:
        current = self.repository.current()
        demo_graph = next(graph for graph in current.workspace.graphs if graph.graph_id == "mathematics-demo")
        topic = next(item for item in demo_graph.topics if item.id == "functions")
        topic.state = "solid"
        demo_graph.quiz_attempts = [
            QuizAttempt(
                id="attempt-functions",
                topic_id="functions",
                passed=True,
                score=1.0,
                question_count=12,
                closure_awarded=True,
            )
        ]

        with self.repository._connect() as conn:  # noqa: SLF001
            self.repository._insert_snapshot(  # noqa: SLF001
                conn,
                current.workspace,
                source="test.seed",
                reason="seed progress before export",
                parent_snapshot_id=current.snapshot.id,
            )

        package = self.repository.export_graph_package("mathematics-demo", title="Math clean", include_progress=False)

        exported_topic = next(item for item in package.graph.topics if item.id == "functions")
        self.assertEqual(package.kind, "mapmind_graph_export")
        self.assertEqual(package.title, "Math clean")
        self.assertEqual(exported_topic.state, "not_started")
        self.assertEqual(package.graph.quiz_attempts, [])

    def test_import_graph_package_can_rename_and_drop_progress(self) -> None:
        current = self.repository.current()
        demo_graph = next(graph for graph in current.workspace.graphs if graph.graph_id == "mathematics-demo")
        topic = next(item for item in demo_graph.topics if item.id == "functions")
        topic.state = "solid"
        demo_graph.quiz_attempts = [
            QuizAttempt(
                id="attempt-functions",
                topic_id="functions",
                passed=True,
                score=1.0,
                question_count=12,
                closure_awarded=True,
            )
        ]

        with self.repository._connect() as conn:  # noqa: SLF001
            self.repository._insert_snapshot(  # noqa: SLF001
                conn,
                current.workspace,
                source="test.seed",
                reason="seed progress before import",
                parent_snapshot_id=current.snapshot.id,
            )

        package = self.repository.export_graph_package("mathematics-demo", include_progress=True)
        imported = self.repository.import_graph_package(package, title="Imported mathematics", include_progress=False)

        imported_graph = next(graph for graph in imported.workspace.graphs if graph.graph_id == "imported-mathematics")
        imported_topic = next(item for item in imported_graph.topics if item.id == "functions")

        self.assertEqual(imported.workspace.active_graph_id, "imported-mathematics")
        self.assertEqual(imported_graph.title, "Imported mathematics")
        self.assertEqual(imported_topic.state, "not_started")
        self.assertEqual(imported_graph.quiz_attempts, [])
        self.assertEqual(imported_graph.metadata["imported_from_graph_id"], "mathematics-demo")
        self.assertFalse(imported_graph.metadata["imported_with_progress"])

    def test_export_graph_to_obsidian_generates_markdown_vault_package(self) -> None:
        current = self.repository.current()
        demo_graph = next(graph for graph in current.workspace.graphs if graph.graph_id == "mathematics-demo")
        topic = next(item for item in demo_graph.topics if item.id == "functions")
        topic.state = "solid"
        topic.description = "Study how a function maps inputs to outputs."
        topic.resources.append(
            ResourceLink(
                id="resource-functions-guide",
                label="Functions guide",
                url="https://example.com/functions-guide",
            )
        )
        topic.artifacts.append(
            Artifact(
                id="artifact-functions-sheet",
                title="Functions sheet",
                kind="notes",
                body="Domain, codomain, and composition notes.",
            )
        )

        with self.repository._connect() as conn:  # noqa: SLF001
            self.repository._insert_snapshot(  # noqa: SLF001
                conn,
                current.workspace,
                source="test.seed",
                reason="seed obsidian export state",
                parent_snapshot_id=current.snapshot.id,
            )

        package = self.repository.export_graph_to_obsidian(
            "mathematics-demo",
            title="Math vault",
            include_progress=True,
            options=ObsidianExportOptions(
                use_folders_as_zones=True,
                include_descriptions=True,
                include_resources=True,
                include_artifacts=True,
            ),
        )

        self.assertEqual(package.kind, "mapmind_obsidian_export")
        self.assertEqual(package.title, "Math vault")
        self.assertEqual(package.folder_name, "Math vault")
        self.assertEqual(package.file_count, len(package.files))

        readme = next(file for file in package.files if file.path == "README.md")
        functions_note = next(file for file in package.files if file.path.endswith("Functions.md"))

        self.assertIn("# Math vault", readme.body)
        self.assertIn("Closed topics", readme.body)
        self.assertIn("## Resources", functions_note.body)
        self.assertIn("## Artifacts", functions_note.body)
        self.assertIn("mapmind_relations:", functions_note.body)
        self.assertIn('mapmind_state: "solid"', functions_note.body)
        self.assertIn("[Functions guide]", functions_note.body)
        self.assertIn("## Requires", functions_note.body)
        self.assertIn("[[Algebra basics]]", functions_note.body)
        self.assertIn("[[Arithmetic and number sense]] via [[Algebra basics]]", functions_note.body)
        self.assertNotIn("## Path context", functions_note.body)

    def test_upsert_topic_preserves_existing_progress_and_artifacts(self) -> None:
        current = self.repository.current()
        demo_graph = next(graph for graph in current.workspace.graphs if graph.graph_id == "mathematics-demo")
        topic = next(item for item in demo_graph.topics if item.id == "functions")
        topic.state = "solid"
        topic.metadata["origin"] = "user"
        topic.artifacts.append(
            Artifact(
                id="artifact-functions-summary",
                title="Functions summary",
                kind="notes",
                body="user-authored notes",
            )
        )

        with self.repository._connect() as conn:  # noqa: SLF001
            self.repository._insert_snapshot(  # noqa: SLF001
                conn,
                current.workspace,
                source="test.seed",
                reason="mutate functions before upsert",
                parent_snapshot_id=current.snapshot.id,
            )

        applied = self.repository.apply_proposal(
            GraphProposal(
                graph_id="mathematics-demo",
                user_prompt="refresh functions topic",
                summary="update functions topic",
                assistant_message="updated",
                operations=[
                    PatchOperation(
                        op="upsert_topic",
                        topic=ProposalTopic(
                            id="functions",
                            slug="functions",
                            title="Functions",
                            description="Updated description",
                            estimated_minutes=360,
                            level=3,
                            state="not_started",
                            zones=["review-school", "ml-runway"],
                            resources=[],
                        ),
                    )
                ],
            )
        )

        updated_graph = next(graph for graph in applied.workspace.graphs if graph.graph_id == "mathematics-demo")
        updated_topic = next(item for item in updated_graph.topics if item.id == "functions")

        self.assertEqual(updated_topic.state, "solid")
        self.assertEqual(updated_topic.metadata["origin"], "user")
        self.assertEqual(updated_topic.artifacts[0].title, "Functions summary")
        self.assertIn("review-school", updated_topic.zones)
        self.assertIn("ml-runway", updated_topic.zones)

    def test_apply_proposal_rejects_topic_zone_reference_without_zone_entity(self) -> None:
        with self.assertRaisesRegex(ValueError, "unknown zone"):
            self.repository.apply_proposal(
                GraphProposal(
                    graph_id="mathematics-demo",
                    user_prompt="add derivatives",
                    summary="invalid zone reference",
                    assistant_message="invalid",
                    operations=[
                        PatchOperation(
                            op="upsert_topic",
                            topic=ProposalTopic(
                                id="derivatives",
                                slug="derivatives",
                                title="Derivatives",
                                zones=["calculus-runway"],
                            ),
                        )
                    ],
                )
            )

    def test_apply_proposal_synchronizes_zone_memberships_bidirectionally(self) -> None:
        applied = self.repository.apply_proposal(
            GraphProposal(
                graph_id="mathematics-demo",
                user_prompt="link embeddings to review zone",
                summary="sync zone membership",
                assistant_message="sync zone membership",
                operations=[
                    PatchOperation(
                        op="upsert_topic",
                        topic=ProposalTopic(
                            id="embeddings",
                            slug="embeddings",
                            title="Embeddings",
                            zones=["review-school", "ml-runway"],
                        ),
                    ),
                    PatchOperation(
                        op="upsert_zone",
                        zone=ProposalZone(
                            id="review-school",
                            title="Review",
                            kind="review",
                            color="#f2a65a",
                            topic_ids=["embeddings"],
                        ),
                    ),
                ],
            )
        )

        graph = next(graph for graph in applied.workspace.graphs if graph.graph_id == "mathematics-demo")
        embeddings = next(topic for topic in graph.topics if topic.id == "embeddings")
        review_zone = next(zone for zone in graph.zones if zone.id == "review-school")
        ml_zone = next(zone for zone in graph.zones if zone.id == "ml-runway")

        self.assertIn("review-school", embeddings.zones)
        self.assertIn("ml-runway", embeddings.zones)
        self.assertIn("embeddings", review_zone.topic_ids)
        self.assertIn("embeddings", ml_zone.topic_ids)

    def test_apply_proposal_assigns_zone_style_deterministically_in_repository(self) -> None:
        applied = self.repository.apply_proposal(
            GraphProposal(
                graph_id="mathematics-demo",
                user_prompt="add cell processes zone",
                summary="style zone on apply",
                assistant_message="style zone on apply",
                operations=[
                    PatchOperation(
                        op="upsert_topic",
                        topic=ProposalTopic(
                            id="cell-membrane-transport",
                            slug="cell-membrane-transport",
                            title="Cell membrane transport",
                            zones=["cell-processes"],
                        ),
                    ),
                    PatchOperation(
                        op="upsert_edge",
                        edge={
                            "id": "edge-functions-cell-transport",
                            "source_topic_id": "functions",
                            "target_topic_id": "cell-membrane-transport",
                            "relation": "requires",
                        },
                    ),
                    PatchOperation(
                        op="upsert_zone",
                        zone=ProposalZone(
                            id="cell-processes",
                            title="Cell Processes",
                            kind="concept",
                            color="purple",
                            intensity=4.0,
                            topic_ids=["cell-membrane-transport"],
                        ),
                    ),
                ],
            )
        )

        graph = next(graph for graph in applied.workspace.graphs if graph.graph_id == "mathematics-demo")
        zone = next(zone for zone in graph.zones if zone.id == "cell-processes")

        self.assertRegex(zone.color, r"^#[0-9a-fA-F]{6}$")
        self.assertNotEqual(zone.color, "purple")
        self.assertLessEqual(zone.intensity, 1.0)

    def test_apply_proposal_is_reversible_via_snapshot_rollback(self) -> None:
        before = self.repository.current()

        applied = self.repository.apply_proposal(
            GraphProposal(
                graph_id="mathematics-demo",
                user_prompt="add exponential function",
                summary="add one topic and one edge",
                assistant_message="added",
                operations=[
                    PatchOperation(
                        op="upsert_topic",
                        topic=ProposalTopic(
                            id="exponential-function",
                            title="Exponential function",
                            slug="exponential-function",
                            description="Growth and decay foundations",
                            estimated_minutes=90,
                            level=2,
                        ),
                    ),
                    PatchOperation(
                        op="upsert_edge",
                        edge={
                            "id": "edge-functions-exponential",
                            "source_topic_id": "functions",
                            "target_topic_id": "exponential-function",
                            "relation": "requires",
                        },
                    ),
                ],
            )
        )

        self.assertNotEqual(
            self._normalized_workspace_structure(applied.workspace),
            self._normalized_workspace_structure(before.workspace),
        )

        rolled_back = self.repository.rollback_to(before.snapshot.id)

        self.assertEqual(
            self._normalized_workspace_structure(rolled_back.workspace),
            self._normalized_workspace_structure(before.workspace),
        )

    @staticmethod
    def _normalized_workspace_structure(workspace):
        payload = workspace.model_dump(mode="json")
        payload.pop("active_graph_id", None)
        for graph in payload.get("graphs", []):
            graph.pop("version", None)
        return payload


if __name__ == "__main__":
    unittest.main()
