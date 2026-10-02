# Project Context

This file is the shared truth layer for coding agents working on Clew.

## One-sentence definition

Clew is a graph-first learning workspace with an AI agent layer for building, auditing, and evolving structured knowledge paths.

## Product identity

Clew is not:

- a note app clone
- a checklist app with AI pasted on top
- a silent graph mutator
- a generic autonomous agent platform

Clew is:

- a graph workspace
- with explicit proposal review
- with rollbackable graph state
- with closure logic tied to actual topics

## Core decisions

The most important long-lived decisions are:

1. graph mutations must be reviewable and reversible
2. the frontend stays graph-first instead of dashboard-first
3. the public local edition and hosted surface stay separate

See:

- [ADR 0001](../adr/0001-graph-mutations-must-be-reviewable-and-reversible.md)
- [ADR 0002](../adr/0002-frontend-stays-graph-first.md)
- [ADR 0003](../adr/0003-local-edition-and-hosted-surface-are-separate.md)

## Architecture in one screen

### Desktop

- Electron launcher and native installers
- bundled Python backend on a private loopback port
- stable secure `clew://app` renderer origin and scoped native export IPC
- mandatory ChatGPT entry screen; optional support links
- local application-data directory and OS credential store

### Frontend

- graph canvas
- workspace shell
- dialogs and settings
- local debug surfaces

### Backend

- repository and snapshots
- Responses API agent loop on Sign in with ChatGPT, with persistent transcripts
- typed Clew tools for proposals, questions and quizzes
- deterministic proposal validation and quiz grading
- ChatGPT OAuth (PKCE, OS credential store) and plan model discovery

### Data

- local SQLite workspace
- graph state
- snapshots
- workspace config
- chat and quiz runtime state

## Quality bar

Clew should feel like:

- a serious solo product
- a portfolio-grade graph workspace
- a public codebase that is readable and worth contributing to

It should not feel like:

- a prototype with hacks
- a dashboard with a graph widget
- a pile of AI features without a center

## Docs split

- `docs/site_faq/` = product-facing docs source
- `docs/` = engineering docs

Agents should preserve that split.
