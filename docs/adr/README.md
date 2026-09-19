# Architecture Decision Records

This directory contains Architecture Decision Records for Clew.

The goal is simple: when a decision is important enough to shape the product or codebase for a long time, it should not live only in somebody's head.

ADR files in this repo are meant to capture:

- the problem
- the decision
- the alternatives that were considered
- the consequences of choosing this path

## Current ADRs

- [0001 - Graph mutations must be reviewable and reversible](0001-graph-mutations-must-be-reviewable-and-reversible.md)
- [0002 - The frontend stays graph-first instead of dashboard-first](0002-frontend-stays-graph-first.md)
- [0003 - The public local edition and hosted product stay split](0003-local-edition-and-hosted-surface-are-separate.md)
- [0004 - External learning bridges preserve the graph boundary](0004-external-learning-bridges-preserve-the-graph-boundary.md)

- [0005 - Codex owns the agent loop; Clew supplies native tools](0005-codex-native-agent-runtime.md)

## Writing rule

An ADR should exist when a decision:

- affects architecture for a long time
- is likely to be questioned later
- protects the product from drifting into something weaker

Do not create ADRs for every tiny implementation detail.
