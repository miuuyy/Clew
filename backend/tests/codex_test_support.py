import os
import tempfile
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.core.config import Settings
from app.main import create_app
from app.services.repository import GraphRepository


def install_client(test, scenario="answer"):
    temp = tempfile.TemporaryDirectory(prefix="clew-api-test-")
    test.addCleanup(temp.cleanup)
    root = Path(temp.name)
    env = patch.dict(os.environ, {"CLEW_CODEX_TEST_SCENARIO": scenario})
    env.start()
    test.addCleanup(env.stop)
    settings = Settings(db_path=root/"state.sqlite3", codex_home=root/"codex", codex_workspace=root/"work",
        codex_binary=str((Path(__file__).parent/"fixtures"/"fake_codex.py").resolve()), codex_rpc_timeout_seconds=30)
    app = create_app(settings)
    client = TestClient(app)
    client.__enter__()
    test.addCleanup(client.__exit__, None, None, None)
    return client, app.state.agent_runtime.repository, app.state.agent_runtime
