import tempfile
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.core.config import Settings
from app.main import create_app
from fake_chatgpt import FakeChatGPT, fake_runtime


def install_client(test, scenario="answer", signed=True):
    temp = tempfile.TemporaryDirectory(prefix="clew-api-test-")
    test.addCleanup(temp.cleanup)
    root = Path(temp.name)
    settings = Settings(db_path=root/"state.sqlite3")
    peer = FakeChatGPT(scenario)
    factory = patch("app.main.AgentRuntime", side_effect=lambda settings, repository: fake_runtime(settings, repository, peer, signed))
    factory.start()
    test.addCleanup(factory.stop)
    app = create_app(settings)
    client = TestClient(app)
    client.__enter__()
    test.addCleanup(client.__exit__, None, None, None)
    return client, app.state.agent_runtime.repository, app.state.agent_runtime
