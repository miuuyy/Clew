# Agent Workflow

This file describes how coding agents should work inside Clew.

## Primary rule

Protect product truth first.

If a change makes the codebase easier to grow but weakens the product identity, trust surface, or architecture invariants, it is the wrong change.

## Implementation workflow

1. Read the latest request carefully.
2. Read only the docs and code needed for that request.
3. Identify the product or architecture invariant that matters.
4. Implement the change without hidden fallback behavior.
5. Run targeted verification.
6. Explain the result in product terms, not only code terms.

## Agent behavior rules

### For product and UI work

- keep the graph central
- prefer high-signal UI over generic chrome
- avoid admin-panel drift

### For agent and Codex runtime work

- trust the selected model as the decision engine
- improve role, context, schema, or validation
- do not add keyword routers or semantic overrides
- supply native tools; do not add a second model loop behind a tool
- keep the existing MCP server separate from the internal agent runtime

### For docs work

- explain what the repo or product is for quickly
- make onboarding obvious
- preserve the split between product docs and engineering docs

## Verification rule

For code changes, agents should run the checks relevant to the area touched.

Common commands:

```bash
cd frontend && npm run typecheck && npm run build
PYTHONPATH=backend ./.venv/bin/python -m unittest discover -s backend/tests -v
```

## Failure rule

If something cannot be implemented cleanly:

- fail explicitly
- say what blocks it
- do not simulate success with a workaround
