import json
import unittest
from pydantic import ValidationError
from app.models.domain import UpdateWorkspaceConfigRequest, WorkspaceConfig
from app.agent.context import turn_context
from codex_test_support import install_client

class WorkspaceConfigTests(unittest.TestCase):
    def setUp(self):
        self.client, self.repo, self.runtime = install_client(self)

    def test_legacy_provider_preferences_migrate_without_selecting_another_model(self):
        config = WorkspaceConfig.model_validate({"ai_provider": "gemini", "default_model": "gemini-2.5-pro", "gemini_api_key": "private", "persona_rules": "Concise"})
        self.assertEqual(config.agent_backend, "codex")
        self.assertIsNone(config.default_model)
        self.assertEqual(config.persona_rules, "Concise")
        self.assertNotIn("private", config.model_dump_json())
        with self.assertRaises(ValidationError):
            UpdateWorkspaceConfigRequest(ai_provider="openai")

    def test_config_round_trip_native_model_effort_and_persona(self):
        response = self.client.post("/api/v1/workspace/config", json={"default_model": "test-codex", "reasoning_effort": "high", "persona_rules": "Use examples", "assistant_nickname": "Tutor"})
        self.assertEqual(response.status_code, 200, response.text)
        config = response.json()["workspace"]["config"]
        self.assertEqual(config["reasoning_effort"], "high")
        self.assertNotIn("gemini_api_key", config)
        reset = self.client.post("/api/v1/workspace/config", json={"default_model": None, "reasoning_effort": None})
        self.assertIsNone(reset.json()["workspace"]["config"]["default_model"])

    def test_memory_presets_and_custom_context_have_visible_effect(self):
        self.repo.update_workspace_config(UpdateWorkspaceConfigRequest(memory_mode="max"))
        self.assertEqual(self.repo.current().workspace.config.memory_history_message_limit, 64)
        self.repo.update_workspace_config(UpdateWorkspaceConfigRequest(memory_mode="custom", memory_include_graph_context=False, memory_include_quiz_context=False))
        graph = self.repo.graph("mathematics-demo")
        context = json.loads(turn_context(graph, self.repo.current().workspace.config, None, []).split("\n", 1)[1])
        self.assertNotIn("graph", context)
        self.assertNotIn("recent_quiz_attempts", context)
        self.assertEqual(context["graph_version"], graph.version)

    def test_account_catalog_and_login_cancellation_use_native_rpc(self):
        response = self.client.get("/api/v1/codex/account")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["authenticated"])
        self.assertEqual(response.json()["models"][0]["model"], "test-codex")
        login = self.client.post("/api/v1/codex/login", json={})
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.json()["loginId"], "test-login")
        self.assertEqual(self.client.post("/api/v1/codex/login/cancel", json={}).status_code, 200)
        self.assertIsNone(self.runtime.login)
