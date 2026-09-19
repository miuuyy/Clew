# Codex migration verification — 2026-09-06, rechecked 2026-09-19

## Implemented and checked

- 80 backend tests pass, including a real subprocess/JSON-RPC test peer, native session resume, streaming replay, interaction persistence, interruption, process failure, timeout containment, unavailable models, quiz generation/grading, proposal transactions, persisted reply grouping and session counts.
- 59 frontend tests pass, including whole-message display, typed preamble replacement, nested card layout, pending questions, interruption and hidden button requests. Type checking, localization checks and the production Vite build pass. Vite reports the existing large-chunk advisory; this does not fail the build.
- The installed native Codex app-server reports `Codex Desktop/0.153.4`. It accepted Clew's namespaced dynamic tool schemas, isolation configuration and thread creation.
- Real `account/read`, ChatGPT OAuth start and cancellation returned successfully. The OAuth destination was `auth.openai.com`. No user credentials were copied or printed.
- `./scripts/dev.sh` starts the app on backend 8787 and frontend 5178, retaining the existing Python 3.13 environment. It no longer substitutes a static build when Vite fails.

On September 19, all 80 backend and 59 frontend tests, type checking, localization and the production build were rechecked. The installed `Codex Desktop/0.155.0-alpha.9.2` accepted initialization, the isolated configuration, native tool schemas and thread creation. Authenticated inference remains outside these checks. An initial run suffered subprocess startup timeouts during extreme host load, followed by a full-disk failure. The successful rerun followed restored disk space; test startup deadlines now allow a loaded host, and the deliberate RPC-timeout test initializes the peer before measuring the missing acknowledgement. Production timeouts are unchanged.

## UI checks

Performed in the visible Codex in-app browser against an isolated temporary SQLite database and the deterministic test peer:

1. Send a chat message; receive a tool-generated question with choices and free text.
2. Reload while the question is pending; restore the same waiting interaction.
3. Answer it; persist the answer and continue the same native turn.
4. Start a second turn and stop it while a question is pending; close the card and release the composer.
5. Choose and save a reasoning option supplied by the model catalog.
6. Prepare and explicitly accept a graph proposal; update the topic and create one snapshot, with the applied badge persisted.
7. Start a 12-question completion test from the existing topic button; submit answers, grade on the server and award completion through the existing workflow.
8. Open the normal local app against the real Codex process; show the available ChatGPT sign-in button.
9. Run two native preambles, a graph read, a proposal and a final answer with delayed text chunks. The UI shows one assistant reply, a nested progress indicator/card and completed text; no partial text or read-tool transcript. After completion it has one proposal card and no pending indicator.
10. Reload that reply, confirm the session count is two (user + assistant), accept its proposal, and reload again. The applied badge persists and exactly one snapshot is added.
11. Restore a waiting question after reload, answer with free text and continue inside the same reply. A subsequent stopped question closes its card without leaving a loader.

The test peer is only a test fixture. Application code never chooses it as a fallback. These checks establish UI/integration behavior; they do not establish the quality of a live model's lesson or proposal. ChatGPT sign-in has not been completed, so authenticated inference still needs a user-owned run.

## Preserved boundaries

- The existing MCP implementation and its tests have no diff.
- The launcher has not been implemented.
- The pre-migration GitHub `main-legacy` backup points to `3a9572cb64cb6b0d6306a99ec7d516c45bdf4304`.
- Reference checkouts remain in the ignored `References/` folder. Native credentials, sessions and the local database remain ignored.

See [Architecture](ARCHITECTURE.md) and [ADR 0005](adr/0005-codex-native-agent-runtime.md) for the resulting boundaries and source owners.
