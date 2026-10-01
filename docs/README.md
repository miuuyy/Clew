# Engineering Docs

This directory contains the engineering-facing markdown for the public `main` branch.

These docs are for people who want to run, inspect, modify, or extend the local edition.

Product-facing website/FAQ source lives in [`site_faq/`](site_faq/README.md). It is grouped here to keep markdown docs in one place, but it is not the same thing as the engineering docs below.

## Recommended reading order

1. [Local Quickstart](LOCAL_QUICKSTART.md)
2. [Architecture](ARCHITECTURE.md)
3. [Agentic Loop](AGENTIC_LOOP.md)
4. [Provider Guide](PROVIDER_GUIDE.md)
5. [Usage Guide](USAGE_GUIDE.md)
6. [Obsidian Bridge](OBSIDIAN.md)
7. [MCP Setup](MCP_SETUP.md)
8. [Latest release](https://github.com/miuuyy/Clew/releases/latest)
9. [Architecture Decision Records](adr/README.md)
10. [Site FAQ source](site_faq/README.md)

## What each file is for

- [Local Quickstart](LOCAL_QUICKSTART.md): exact setup, reset, and local runtime workflow
- [Architecture](ARCHITECTURE.md): repository structure, boundaries, domain model, and service layout
- [Agentic Loop](AGENTIC_LOOP.md): the decision and apply loop behind chat, proposals, quizzes, and rollback
- [Provider Guide](PROVIDER_GUIDE.md): built-in providers, model config, and how to add another provider cleanly
- [Usage Guide](USAGE_GUIDE.md): source-material guidance for generating high-quality ingest input
- [Obsidian Bridge](OBSIDIAN.md): import an Obsidian vault into Clew or export a graph back into Markdown
- [MCP Setup](MCP_SETUP.md): connect Clew Study Assist to Claude Desktop, Claude Code, or Cursor via the built-in MCP server
- [Latest release](https://github.com/miuuyy/Clew/releases/latest): release notes live on GitHub
- [ADR index](adr/README.md): long-lived decisions, including why external bridges must preserve the graph boundary
- [Site FAQ source](site_faq/README.md): product-facing pages rendered at clew.my/docs

## What is intentionally not here

This directory is not meant to become a graveyard of speculative product plans. It should stay close to code that actually exists in `main`.
