# ADR 0005: Codex owns the agent loop; Clew supplies native tools

- Status: accepted
- Date: 2026-09-06

## Context

The previous local runtime classified requests into a JSON action and then called a separate provider-backed planner, assistant or quiz generator. This tightly coupled learning behavior to a custom orchestration loop, while the product already had useful deterministic graph, review and grading boundaries.

## Decision

Use the installed Codex CLI app-server as the sole agent runtime, with native ChatGPT OAuth, model discovery, persistent threads, streamed messages and dynamic tool calls. Normal answers remain text. Clew supplies scoped graph reads, proposal tools, questions and quizzes. Tool handlers validate and execute application operations; they never invoke another model.

Keep graph mutation behind explicit user review. Add revision checks, durable proposal receipts and atomic graph/chat updates. Preserve existing graphs, snapshots, conversations, resources, artifacts and progress. Migrate legacy provider settings to an unset native model preference while preserving study/UI settings. Old provider secrets are not surfaced to the new runtime or UI.

Use an isolated application Codex home, working directory and read-only sandbox. Do not integrate or modify the existing MCP server. Do not build the future launcher in this change.

## Consequences

- Codex determines the next conversational action through its normal tool loop.
- Questions and checkpoint answers are durable interactions that resume the same native turn.
- Clew preserves its nested reply UI. Native item streaming updates progress and cards, while completed text appears as whole messages; tools and preambles do not become a separate transcript.
- Login, token refresh, native history and compaction are owned by Codex.
- Clew remains responsible for validation, graph revisions, user approval, snapshots and grading.
- Old direct provider/planner/assistant APIs and API-key configuration are removed.
- Dynamic tools use an experimental protocol, verified against the installed 0.153.4 build. Incompatible versions fail explicitly.
- Backend restart interrupts an unfinished turn but preserves its conversation binding; it does not silently create a replacement.

## References

- [Codex app-server](https://learn.chatgpt.com/docs/app-server)
- Local source references and pinned commits: `References/README.md`.
- Implementation and verification boundaries: [Architecture](../ARCHITECTURE.md).
