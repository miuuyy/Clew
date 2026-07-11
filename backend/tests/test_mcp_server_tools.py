from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.mcp_server import server, tools
from app.services.repository import GraphRepository


class MpcServerToolsTests(unittest.TestCase):
    def setUp(self) -> None:
        tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(tempdir.cleanup)
        self.temp_path = Path(tempdir.name)
        self.repository = GraphRepository(self.temp_path / "state.sqlite3")
        self.workspace = self.repository.current().workspace

    def test_list_graphs_returns_seeded_graph(self) -> None:
        result = tools.list_graphs(self.workspace)

        self.assertEqual(result["active_graph_id"], "mathematics-demo")
        self.assertEqual(len(result["graphs"]), 1)
        self.assertEqual(result["graphs"][0]["graph_id"], "mathematics-demo")

    def test_get_current_context_aggregates_active_graph(self) -> None:
        result = tools.get_current_context(self.workspace)

        self.assertEqual(result["active_graph_id"], "mathematics-demo")
        self.assertEqual(len(result["graphs"]), 1)
        self.assertIn("in_progress_topics", result["graphs"][0])

    def test_get_node_returns_neighbors_and_blockers(self) -> None:
        result = tools.get_node(self.workspace, graph_id="mathematics-demo", node_id="functions")

        self.assertEqual(result["node_id"], "functions")
        self.assertTrue(any(item["relation"] == "requires" for item in result["neighbors"]))
        self.assertIn("blocked_by", result)

    def test_search_notes_matches_title_and_description(self) -> None:
        result = tools.search_nodes(self.workspace, query="functions")

        self.assertGreaterEqual(result["total_matches"], 1)
        self.assertEqual(result["results"][0]["node_id"], "functions")

    def test_clew_db_path_overrides_shared_backend_path(self) -> None:
        clew_path = self.temp_path / "clew.sqlite3"
        shared_path = self.temp_path / "shared.sqlite3"

        with patch.dict(
            "os.environ",
            {"CLEW_DB_PATH": str(clew_path), "KG_DB_PATH": str(shared_path)},
        ):
            self.assertEqual(server._resolve_db_path(), clew_path.resolve())
