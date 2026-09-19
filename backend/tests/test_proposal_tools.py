import unittest
from uuid import uuid4
from app.agent.contracts import ProposalDraft, tool_specs
from app.models.domain import ChatMessage, CreateGraphRequest, UpdateWorkspaceConfigRequest
from app.services.proposal_service import ProposalService
from app.services.repository import ProposalConflictError, RepositoryConflictError
from codex_test_support import install_client

class ProposalToolTests(unittest.TestCase):
    def setUp(self):
        self.client, self.repo, self.runtime = install_client(self)
        self.graph_id = "mathematics-demo"
        self.url = f"/api/v1/graphs/{self.graph_id}/apply"

    def draft(self, **topic_values):
        return ProposalDraft.model_validate({"base_graph_version": self.repo.graph(self.graph_id).version,
            "summary": "Update arithmetic", "operations": [{"op_id": "topic", "op": "upsert_topic", "entity_kind": "topic",
            "topic": {"id": "arithmetics", "title": "Arithmetic", "slug": "arithmetics", "description": "A revised explanation", **topic_values}}]})

    def prepare(self, draft=None):
        return ProposalService().prepare(self.repo.graph(self.graph_id), draft or self.draft(), tool="propose_expand", proposal_id=f"test-{uuid4().hex}", prompt="Explain", model="test-codex", use_grounding=False)

    def apply(self, proposal):
        return self.client.post(self.url, json=proposal.proposal_envelope.model_dump(mode="json"))

    def test_accept_is_atomic_with_chat_receipt_and_idempotent(self):
        proposal = self.prepare()
        self.repo.append_chat_message(self.graph_id, ChatMessage(id="proposal-message", role="assistant", content="", proposal=proposal))
        first = self.apply(proposal)
        self.assertEqual(first.status_code, 200, first.text)
        snapshot = first.json()["snapshot"]["id"]
        second = self.apply(proposal)
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(second.json()["snapshot"]["id"], snapshot)
        self.assertTrue(self.repo.chat_thread(self.graph_id).messages[0].proposal_applied)

    def test_stale_proposal_returns_409_without_overwriting_user_edits(self):
        proposal = self.prepare()
        self.repo.mark_topic_finished(self.graph_id, "arithmetics")
        before = self.repo.current().snapshot.id
        response = self.apply(proposal)
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(self.repo.current().snapshot.id, before)

    def test_legacy_unversioned_proposal_is_visible_but_cannot_be_applied(self):
        proposal = self.prepare()
        proposal.proposal_envelope.base_graph_version = None
        self.assertEqual(self.apply(proposal).status_code, 409)

    def test_reused_proposal_id_with_different_operations_is_rejected(self):
        proposal = self.prepare()
        self.assertEqual(self.apply(proposal).status_code, 200)
        proposal.proposal_envelope.operations[0].topic.description = "Changed under the same id"
        self.assertEqual(self.apply(proposal).status_code, 409)

    def test_rollback_never_reuses_a_graph_revision(self):
        original = self.repo.current().snapshot.id
        proposal = self.prepare()
        self.repo.mark_topic_finished(self.graph_id, "arithmetics")
        previous = self.repo.graph(self.graph_id).version
        self.repo.rollback_to(original)
        self.assertGreater(self.repo.graph(self.graph_id).version, previous)
        self.assertEqual(self.apply(proposal).status_code, 409)

    def test_retry_after_another_edit_returns_current_workspace(self):
        proposal = self.prepare()
        self.assertEqual(self.apply(proposal).status_code, 200)
        latest = self.repo.update_workspace_config(UpdateWorkspaceConfigRequest(assistant_nickname="New name"))
        response = self.apply(proposal)
        self.assertEqual(response.json()["snapshot"]["id"], latest.snapshot.id)
        self.assertEqual(response.json()["workspace"]["config"]["assistant_nickname"], "New name")

    def test_partial_topic_edit_preserves_omitted_study_metadata(self):
        topic = next(t for t in self.repo.graph(self.graph_id).topics if t.id == "arithmetics")
        proposal = self.prepare()
        edited = proposal.proposal_envelope.operations[0].topic
        self.assertEqual(edited.estimated_minutes, topic.estimated_minutes)
        self.assertEqual(edited.level, topic.level)
        self.assertEqual(edited.difficulty, topic.difficulty)
        self.assertEqual(edited.description, "A revised explanation")

    def test_resource_urls_fail_closed_without_silent_sanitization(self):
        with self.assertRaisesRegex(ValueError, "HTTP"):
            self.prepare(self.draft(resources=[{"label": "Unsafe", "url": "javascript:alert(1)"}]))

    def test_resources_receive_stable_ids_without_changing_content(self):
        proposal = self.prepare(self.draft(resources=[{"label": "Notes", "url": "https://example.org/notes"}]))
        resource = proposal.proposal_envelope.operations[0].topic.resources[0]
        self.assertEqual(resource.id, "arithmetics_resource_1")
        self.assertEqual(resource.url, "https://example.org/notes")

    def test_unknown_zone_fails_without_fabricating_zone(self):
        with self.assertRaisesRegex(ValueError, "unknown zones"):
            self.prepare(self.draft(zones=["nonexistent-zone"]))

    def test_model_cannot_award_completion_to_new_topic(self):
        with self.assertRaisesRegex(ValueError, "not_started"):
            self.prepare(self.draft(id="new-topic", state="mastered"))

    def test_tool_proposal_rejects_a_stale_context_version(self):
        draft = self.draft()
        self.repo.mark_topic_finished(self.graph_id, "arithmetics")
        with self.assertRaisesRegex(ValueError, "read_graph again"):
            self.prepare(draft)

    def test_stale_whole_workspace_write_is_rejected(self):
        current = self.repo.current()
        self.repo.update_workspace_config(UpdateWorkspaceConfigRequest(assistant_nickname="latest"))
        with self.repo._connect() as conn:
            with self.assertRaises(RepositoryConflictError):
                self.repo._insert_snapshot(conn, current.workspace, source="test", reason="stale", parent_snapshot_id=current.snapshot.id)
        self.assertEqual(self.repo.current().workspace.config.assistant_nickname, "latest")

    def test_tools_are_native_functions_and_answer_is_not_a_tool(self):
        specs = tool_specs()
        self.assertEqual(specs[0]["type"], "namespace")
        names = {tool["name"] for tool in specs[0]["tools"]}
        self.assertEqual(names, {"read_graph", "read_topic", "propose_ingest", "propose_expand", "ask_question", "present_quiz", "create_closure_quiz"})
        self.assertNotIn("answer", names)
