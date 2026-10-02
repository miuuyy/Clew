# Local development

For installation without development tools, use the [desktop downloads](https://github.com/miuuyy/Clew/releases/latest). See [Desktop](DESKTOP.md) for native Windows setup and packaging.

## Requirements

Node 22.22.2+, Python 3.11+, a ChatGPT Plus or Pro plan, and an OS credential store. On Linux, run inside a desktop session with Secret Service and D-Bus.

```bash
git clone https://github.com/miuuyy/Clew.git
cd Clew
cp .env.example .env
./scripts/dev.sh
```

The script installs dependencies and starts FastAPI at `http://127.0.0.1:8787` and Vite at `http://127.0.0.1:5178`. It fails explicitly if either listener cannot start. Stop them with `./scripts/stop_dev.sh`.

The first screen is **Continue with ChatGPT**. Finish OAuth in your browser and grant plan usage. The workspace becomes available after authentication. No API key or Codex CLI is used.

Browser development data lives at `backend/data/knowledge_graph.sqlite3`. The Electron app has a separate application-data directory. Existing files are not moved or deleted automatically. `scripts/reset_db.sh` is an explicit destructive development reset; back up your workspace first.

For Electron development, run `npm ci && npm run dev` after setting up `.venv` and frontend dependencies. Release builds require `desktop/requirements.txt`; see [Desktop](DESKTOP.md).
