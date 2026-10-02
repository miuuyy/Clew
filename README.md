# Clew

[Download](https://github.com/miuuyy/Clew/releases/latest) · [Docs](https://clew.my/docs) · [Contributing](CONTRIBUTING.md) · [MIT](LICENSE)

**A learning graph, powered by your ChatGPT plan.**

Clew turns a goal, syllabus, or folder of notes into a map of topics and prerequisites. Click a topic to see the path behind it. Study with an assistant, review its proposals, and keep your progress attached to the graph.

Your graphs live on your computer. AI changes require your approval, and accepted changes can be rolled back.

## Install

Download the build for your computer from [Releases](https://github.com/miuuyy/Clew/releases/latest).

| Platform | Builds |
| --- | --- |
| Windows | x64 installer |
| macOS 13+ | Apple Silicon and Intel, DMG or ZIP |
| Linux | x64 and arm64, AppImage or Debian package; see platform requirements |

Open Clew and select **Continue with ChatGPT**. A ChatGPT **Plus or Pro** plan and permission to use that plan are required. You do not need Python, Node, an API key, or the Codex CLI installed.

GitHub stars and X follows are optional. They do not unlock features or change access.

The 1.0.0 downloads are not Developer ID notarized or Authenticode signed. macOS builds have an ad-hoc signature. See [installation notes](docs/DESKTOP.md) for platform requirements and data locations.

**Help → Check for Updates** opens the newer release's installer page. Updates are installed manually and retain local data.

## Work through a subject

1. Create a graph from your goal or import an Obsidian vault.
2. Select a topic to inspect its prerequisites, resources, and notes.
3. Ask the assistant to explain, quiz you, or expand the graph.
4. Review a proposal and apply it when the structure makes sense.
5. Finish a topic through the study workflow. Roll back a snapshot when needed.

Clew includes two graph views, Midnight and Paper themes, completion quizzes, Markdown and graph export, and a read-only MCP server for other assistants. The ChatGPT web plugin is a separate future integration; it is not part of this release.

## Privacy and control

- Graphs, snapshots, and conversation history are stored in a local SQLite database.
- ChatGPT credentials stay in the operating system's credential store.
- AI requests send the conversation and scoped learning context to OpenAI. They use your existing plan allowance.
- Set Clew's weekly allowance in **ChatGPT → Settings → Usage → App limits**.
- The model proposes changes. Clew validates them; you choose whether to apply them.
- Sign-out locks the workspace interface without deleting local data.

## Development

Requirements: Node 22.22.2+, Python 3.11+, and an OS credential store.

```bash
git clone https://github.com/miuuyy/Clew.git
cd Clew
cp .env.example .env
./scripts/dev.sh
```

Open `http://127.0.0.1:5178`. The browser development build uses the same ChatGPT entry screen. To run the Electron app, install its tooling and start it:

```bash
npm ci
npm run dev
```

For native Windows setup and release builds, see [Desktop development](docs/DESKTOP.md).

```bash
npm run check:version
npm run test:desktop
npm --prefix frontend run typecheck
npm --prefix frontend run test
npm --prefix frontend run test:localization
npm --prefix frontend run build
PYTHONPATH=backend ./.venv/bin/python -m unittest discover -s backend/tests -v
```

## Source map

| Directory | Owns |
| --- | --- |
| `desktop/` | Electron lifecycle, local backend packaging, native builds and release checks |
| `frontend/src/` | Sign-in, graph workspace, proposal review and study UI |
| `backend/app/agent/` | ChatGPT authentication, Responses requests and typed tools |
| `backend/app/services/` | SQLite repository, snapshots, validation and grading |
| `contracts/` | Graph operation and proposal contracts |
| `docs/` | Engineering documentation |
| `docs/site_faq/` | Product documentation source |

Read [Architecture](docs/ARCHITECTURE.md) and [Project Context](docs/agents/PROJECT_CONTEXT.md) before changing product behavior.
