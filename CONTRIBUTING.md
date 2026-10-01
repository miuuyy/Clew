# Contributing to Clew

Thanks for wanting to contribute.

Clew is a graph-first learning workspace, so good contributions usually make the product clearer, calmer, and more trustworthy for real study. The best changes strengthen the graph surface, provider seam, study flow, or repository clarity without turning the project into generic dashboard software.

## Before you start

Please do one of these first:

- open an issue for a bug
- open an issue or discussion for a feature idea
- link the problem you are solving in your pull request

That keeps the repository from filling up with well-meant but misaligned changes.

## Good contribution areas

Strong contribution areas include:

- graph workspace UX
- proposal review and rollback flows
- provider integrations
- import and export improvements
- quiz and closure quality
- architecture cleanup that preserves product boundaries
- documentation improvements
- debugging and developer tooling for the local edition

Less useful contributions usually push the repository toward:

- generic note-taking features
- AI behavior hidden behind silent fallbacks
- dashboard chrome with weak product value
- unrelated platform ambitions

## Development setup

Clone the repository and start the local stack:

```bash
git clone https://github.com/miuuyy/Clew.git
cd Clew
cp .env.example .env
./scripts/dev.sh
```

Open:

- frontend: `http://127.0.0.1:5178`
- backend: `http://127.0.0.1:8787`

You only need one provider key:

- `KG_GEMINI_API_KEY`
- or `KG_OPENAI_API_KEY`

## Development workflow

### 1. Create a branch

Use a descriptive branch name:

```bash
git checkout -b fix/graph-overlay-layout
git checkout -b docs/rewrite-readme
git checkout -b feat/custom-provider
```

### 2. Make the change

Prefer explicit, reviewable changes over clever shortcuts.

If you touch agent or proposal behavior, keep these repository boundaries in mind:

- the model should operate through contracts, not hidden keyword routers
- AI should not silently mutate the graph
- accepted graph changes should remain reversible
- fail-closed beats fake success

### 3. Run checks

```bash
cd frontend && npm run typecheck && npm run build
cd ..
PYTHONPATH=backend ./.venv/bin/python -m unittest discover -s backend/tests -v
```

### 4. Open a pull request

A strong pull request usually includes:

- what changed
- why it changed
- what user or developer problem it fixes
- how you verified it

If there is visible UI behavior, include screenshots or a short before/after explanation.

## Documentation contributions

Clew uses two documentation layers:

- `docs/site_faq/` for product-facing docs rendered at clew.my/docs
- `docs/` for engineering and local-developer guides

If you add or rewrite docs, keep the distinction clean:

- product docs should explain use, value, and behavior
- engineering docs should explain setup, structure, and implementation

## Repository ergonomics

This repo already includes:

- a local-first runtime
- readable internal docs
- project-specific skills
- a partially prepared CI-agent workflow

That means you do not need to reverse-engineer the whole codebase before contributing. The goal is to make serious contributions possible even for people using agent help.

## Style expectations

- Keep changes focused.
- Prefer clarity over cleverness.
- Do not ship hacks disguised as architecture.
- Do not add dead files “just in case”.
- If you add a new surface, document it.

## If you are unsure

If you are unsure whether an idea fits the project, open an issue first and describe:

- the problem
- the proposed change
- why it belongs in Clew specifically

That is much better than building a large feature around the wrong product assumption.
