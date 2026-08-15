# Provider Guide

Clew ships with a provider seam instead of a one-provider integration.

That seam is important for two reasons:

1. the local edition should stay usable with more than one model family
2. provider behavior should live in explicit code, not in hidden shell hacks

## Built-in providers

### Gemini

Config:

```text
KG_AI_PROVIDER=gemini
KG_GEMINI_API_KEY=...
```

Current model options:

- `gemini-3.7-flash`
- `gemini-2.5-pro`
- `gemini-2.5-flash`
- `gemini-2.5-flash-lite`
- `gemini-3-pro-preview`
- `gemini-3-flash-preview`

### OpenAI

Config:

```text
KG_AI_PROVIDER=openai
KG_OPENAI_API_KEY=...
KG_OPENAI_BASE_URL=https://api.openai.com/v1
```

Current model options:

- `gpt-5.4`
- `gpt-5.4-mini`
- `gpt-5.4-nano`
- `gpt-5.1`
- `gpt-4.1`
- `gpt-4.1-mini`

## What the provider layer is used for

The provider seam supports:

- plain text generation
- structured generation into typed schemas
- grounded or web-enabled requests when the provider supports them

Clew uses that layer for:

- proposal generation
- chat orchestration decisions
- study assistant replies
- quiz generation

## Where the seam lives

Provider code lives in:

```text
backend/app/llm/
```

Key files:

- `base.py`
- `catalog.py`
- `registry.py`
- `gemini_provider.py`
- `openai_provider.py`
- `contracts.py`
- `schemas.py`

## Workspace config fields

The workspace stores provider-related config explicitly:

- `ai_provider`
- `default_model`
- `gemini_api_key`
- `openai_api_key`
- `openai_base_url`
- `use_google_search_grounding`

That keeps provider selection in user-visible state instead of burying it in environment-only configuration.

## Grounding

Both built-in providers currently advertise support for grounded requests.

At the product level, grounding is still governed by the current request and workspace settings. Do not assume that every prompt is automatically web-enabled just because the provider can do it.

## Adding a new provider

If you want to add another provider cleanly:

1. create a new provider implementation in `backend/app/llm/`
2. implement the same high-level generation interface used by the built-ins
3. add a catalog entry in `backend/app/llm/catalog.py`
4. register the provider in `backend/app/llm/registry.py`
5. make sure structured generation works against the same schema boundaries
6. expose model options so the frontend settings surface can render them

## What a good provider integration should preserve

A provider integration should preserve the same architectural rules as the built-ins:

- typed output where typed output is expected
- no hidden provider switching
- no silent success shims
- explicit configuration
- obvious error surfaces when something is unsupported or misconfigured

If a provider cannot satisfy the contract, it should fail honestly rather than pretending to work.
