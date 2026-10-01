# CLAUDE.md

This file provides repository-specific guidance to Claude Code when working in Clew.

## Read first

Before making changes, read:

- [Shared agent context](docs/agents/PROJECT_CONTEXT.md)
- [Agent workflow](docs/agents/WORKFLOW.md)
- [Architecture](docs/ARCHITECTURE.md)
- [ADR index](docs/adr/README.md)

## Product overview

Clew is a graph-first learning workspace with an AI agent layer.

If Obsidian is where you collect notes, Clew is where you operate on a learning graph.

The public `main` branch is the **local developer edition**. It keeps:

- graph workspace
- provider seam
- proposals
- snapshots and rollback
- quizzes and closure logic
- import/export

It does not try to mirror every hosted product surface.

## Core boundaries

Never weaken these:

1. The graph is the center of truth.
2. AI suggests changes instead of silently applying them.
3. Accepted graph changes stay reversible through snapshots.
4. The UI stays graph-first instead of dashboard-first.
5. The public local edition stays honest about being local-first.

## Engineering rules

- Prefer explicit contracts over heuristics.
- Prefer fail-closed over hidden fallback.
- Do not add semantic keyword routers for agent behavior.
- Keep model behavior honest through role, context, and schema.
- Do not add dead surfaces “just in case”.

## Frontend quick map

- `frontend/src/App.tsx`: app shell and state wiring
- `frontend/src/components/WorkspaceShell.tsx`: sidebar and workspace chrome
- `frontend/src/components/GraphCanvas.tsx`: graph rendering and interaction
- `frontend/src/components/SettingsModal.tsx`: provider, memory, debug, and UX controls
- `frontend/src/lib/`: API, graph helpers, copy, contracts, debug logging
- `frontend/src/styles/system.css`: design tokens (`--ui-*`, both themes) and shared controls (`ui*` classes)
- `frontend/src/styles/components/`: component styles built only on those tokens; new UI goes here, not into the legacy theme files
- `frontend/src/components/ui/`: shared `Modal` and `SwitchRow`

## Backend quick map

- `backend/app/api/routes.py`: HTTP transport
- `backend/app/services/repository.py`: SQLite persistence, snapshots, config
- `backend/app/services/chat_orchestrator.py`: answer/quiz/proposal action choice
- `backend/app/services/proposal_planner.py`: proposal generation and validation bridge
- `backend/app/llm/`: providers, catalog, prompts, contracts, schemas

## Local commands

Start dev:

```bash
./scripts/dev.sh
```

Run frontend checks:

```bash
cd frontend && npm run typecheck && npm run build
```

Run backend tests:

```bash
PYTHONPATH=backend ./.venv/bin/python -m unittest discover -s backend/tests -v
```

## Repo-specific help

This repo includes repo-local Claude context:

- [Agent docs index](docs/agents/README.md)
- `.claude/skills/` for product, docs, and agent-boundary checks

Use them when they fit instead of re-deriving the same repo context every time.
