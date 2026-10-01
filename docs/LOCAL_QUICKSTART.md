# Local Quickstart

This guide is for developers and advanced users who want to run the public `main` branch locally.

Clew is local-only: there is no hosted workspace. Product docs live at [clew.my/docs](https://clew.my/docs).

## Requirements

- macOS or Linux shell environment
- Python 3.11+
- Node 20+ or Node 22
- a ChatGPT Plus or Pro plan for AI features
- an OS credential store (Keychain on macOS, Secret Service on Linux)

## Start the app

```bash
git clone https://github.com/miuuyy/Clew.git
cd Clew
cp .env.example .env
./scripts/dev.sh
```

Open:

- frontend: `http://127.0.0.1:5178`
- backend: `http://127.0.0.1:8787`

## Deploy note

The frontend supports two runtime shapes:

- same-origin: frontend and backend are served from the same origin
- split-origin: frontend and backend are deployed to different origins

For split-origin deploys, set both sides explicitly:

```bash
VITE_API_BASE=https://api.example.com
KG_FRONTEND_ORIGIN=https://app.example.com
```

If you skip those values, the frontend falls back to its own origin and backend CORS stays on the local default.

## What the dev script does

`./scripts/dev.sh` is the intended entry path. It:

- creates `.venv` when needed
- installs backend dependencies in editable mode
- installs frontend dependencies
- starts FastAPI with reload
- starts Vite with strict port handling

If Vite cannot bind normally, the script falls back to a static frontend server.

## Sign in with ChatGPT

AI features run on your ChatGPT plan. Open **Settings → ChatGPT → Sign in with ChatGPT** and approve the consent page. The OAuth redirect is `http://127.0.0.1:8787/auth/callback`, so the backend must be running on its default port. Tokens are stored in the OS credential store. Set a weekly limit for Clew in ChatGPT **Settings → Usage → App limits**.

No provider API keys are used.

## Local data

The local workspace database lives here:

```text
backend/data/knowledge_graph.sqlite3
```

It stores:

- graphs
- snapshots
- chat state
- quiz state
- workspace configuration

## Reset the database

If you want to wipe the local workspace and go back to the seed state:

```bash
./scripts/reset_db.sh
```

## Stop local listeners

```bash
./scripts/stop_dev.sh
```

That stops listeners on:

- `8787`
- `5178`
- `5179`

## Common checks

```bash
cd frontend && npm run typecheck
cd frontend && npm run build
PYTHONPATH=backend ./.venv/bin/python -m unittest discover -s backend/tests -v
```

## Recommended first run

1. boot the workspace
2. open the starter graph
3. sign in with ChatGPT in settings
4. ask for a focused expansion
5. review the proposal
6. apply it and try a closure quiz

That gives you the shortest honest tour of the product.

## Troubleshooting

### The backend or frontend port is already in use

Run:

```bash
./scripts/stop_dev.sh
```

Then start again.

### The workspace feels broken after experiments

Reset the local SQLite state:

```bash
./scripts/reset_db.sh
```

### You want raw local error traces

Enable **Debug mode** in settings. That exposes a `Logs` surface in the local shell and writes debug output to:

```text
logs/logs.log
```
