# ChatGPT connection

Clew 1.0.0 uses Sign in with ChatGPT and the Responses API. There are no Gemini, API-key, Codex CLI, or alternate-provider modes.

Select **Continue with ChatGPT** on the entry screen and approve plan usage in your browser. Clew requires a ChatGPT Plus or Pro plan. Identity-only consent does not unlock the workspace. Tokens stay in the OS credential store; the installation ID, issued client ID and verified account label stay next to the database.

The model list comes from the account's plan. An unavailable selected model fails explicitly. The model chooses when to use web search and Clew's typed tools. Tools validate proposals and return a review surface; they never call a second model or apply changes silently.

Control per-app usage in **ChatGPT → Settings → Usage → App limits**. A limit for Clew is part of the existing plan allowance, not a separate subscription. Changing reasoning effort or model does not bypass that limit.

Connection and model settings are in **Settings → ChatGPT** after entry. Sign-out returns to onboarding without deleting local graphs or snapshots.

Owners:

- `backend/app/agent/chatgpt_auth.py`: OAuth, identity verification, storage and refresh.
- `backend/app/agent/chatgpt_api.py`: model discovery and Responses streaming.
- `backend/app/agent/runtime.py`: explicit agent lifecycle and tools.
- `frontend/src/App.tsx`: authentication boundary.
- `frontend/src/components/SignIn.tsx`: entry screen.

See [ADR 0006](adr/0006-sign-in-with-chatgpt-agent-runtime.md) and [ADR 0007](adr/0007-desktop-release-and-required-sign-in.md).
