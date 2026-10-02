import tempfile
import unittest
from pathlib import Path

from app.agent.runtime import AgentRuntime
from app.core.config import Settings
from app.services.repository import GraphRepository


class CredentialIsolationTests(unittest.IsolatedAsyncioTestCase):
    async def test_desktop_credentials_are_stable_and_scoped_to_the_data_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            accounts = []
            for name in ("installed", "smoke", "installed"):
                settings = Settings(db_path=Path(directory) / name / "state.sqlite3", desktop_token="explicit-test-session")
                runtime = AgentRuntime(settings, GraphRepository(settings.db_path))
                try:
                    accounts.append(runtime.auth.store.account)
                finally:
                    await runtime.close()
            self.assertEqual(accounts[0], accounts[2])
            self.assertNotEqual(accounts[0], accounts[1])
            self.assertNotIn(directory, accounts[0])
