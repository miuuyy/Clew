# Features

Clew is a personal adaptive roadmap builder for serious learning.

The center is simple: **a thread through anything you're learning**. Everything else exists to make that thread easier to generate, inspect, trust, and keep.

## Core Product

- `Personal adaptive roadmaps`: build a graph around your actual goal instead of following a public static checklist.
- `AI graph generation`: paste messy topics, describe a target, or import notes; the model can draft a real prerequisite structure with broad topic counts.
- `Reviewable proposals`: AI does not silently mutate the graph. You inspect the proposal, apply it, reject it, and roll back through snapshots when needed.
- `Graph-first workspace`: topics, dependencies, zones, resources, artifacts, layout, and progress live on the main surface.
- `Path reading`: click a topic and see what surrounds it: foundations, blockers, frontier, related branches, and what can wait.
- `Study closure`: use closure quizzes for stricter learning or mark topics finished manually when the workspace should stay lightweight.

## Interface

- `Midnight and Paper themes`: a dark graph mood and a brighter light workspace.
- `Floating windows`: the dock, the graph list, the assistant, and the topic card float over the graph instead of boxing it in.
- `Better graph feel`: manual layout editing, saved positions, smoother idle motion, stable curved edges, zone styling, and denser graph readability.

## AI Control

- `Sign in with ChatGPT`: the agent runs on your ChatGPT Plus or Pro plan. No API keys, no CLI.
- `Model and reasoning`: pick any model your plan offers and set the reasoning effort.
- `Memory controls`: decide how much history, graph context, progress, quiz state, frontier, and selected-topic context the agent sees.
- `Web search`: offered on every chat turn; the model decides when a question needs fresh sources.
- `Persona rules`: shape the assistant as part of the workspace instead of treating behavior as a hidden constant.

## Obsidian Bridge

- `Import from Obsidian`: choose a vault folder, convert Markdown notes into topics, infer links, create zones from folders, preview validation, and import.
- `Export to Obsidian`: write a graph as an Obsidian-ready folder with topic notes, resources, artifacts, zone folders, and graph metadata.
- `Local graph packages`: move Clew graphs in and out of the local edition with optional progress.

## MCP

- `Clew Study Assist`: a read-only MCP server for Claude Desktop, Claude Code, Cursor, and other MCP clients.
- `Graph-aware assistant context`: external tools can list graphs, inspect the current learning context, search notes, and open a topic with neighbors and blockers.
- `No silent writes`: MCP is read-only. Graph edits still go through the Clew proposal/review/apply flow.

## Local By Design

- `SQLite workspace`: graphs, snapshots, chat state, quiz state, and config live in one file on your disk.
- `OS credential store`: ChatGPT tokens stay in Keychain or Secret Service.
- `Snapshots and rollback`: accepted graph changes remain recoverable.
- `Debug logs`: optional local logging for frontend, API, and backend errors.

## Open Source

- `MIT licensed`: read the code, fork it, change it.
- `No Clew server`: requests go from your machine to OpenAI under your own plan. There is nothing in between.

Everything points at the same product truth: **AI helps create the path, but the graph stays visible, editable, and yours.**
