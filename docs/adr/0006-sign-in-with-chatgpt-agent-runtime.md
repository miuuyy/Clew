# ADR 0006: Clew runs its agent loop on Sign in with ChatGPT

- Status: accepted
- Date: 2026-10-02
- Supersedes: [ADR 0005](0005-codex-native-agent-runtime.md)

## Context

ADR 0005 made the installed Codex CLI app-server the agent runtime. That required every learner to install a separate CLI of a compatible version, and it depended on an experimental dynamic-tools protocol. OpenAI's Sign in with ChatGPT (DevDay 2026) lets a local open-source app obtain OAuth credentials with the `chatgpt.tokens.use.direct` scope and call the public Responses API on the learner's ChatGPT Plus or Pro plan, without an API key or a CLI.

## Decision

Clew owns a small agent loop on the Responses API, authenticated with Sign in with ChatGPT.

- OAuth 2.0 authorization code with PKCE and an OIDC nonce, dynamic client registration (`dynamic_agent_client`), a loopback redirect on the backend port and verified RS256 ID tokens. The issued client id is reused for later sign-ins.
- Access and refresh tokens live only in the OS credential store (`keyring`). There is no plaintext fallback. The non-secret registration and account label live next to the database.
- Responses requests use `store: false`. Clew persists the conversation's input items (messages, function calls and outputs, encrypted reasoning) per chat session and re-sends them each step.
- The Clew tools from ADR 0005 are unchanged in behavior and are supplied as Responses function tools. Handlers validate and execute application operations; they never invoke another model. One learner turn is bounded to a fixed number of model steps.
- Only Plus and Pro plans are supported. Plan, limit and capability errors are shown as returned; there is no API-key or alternate-provider fallback.
- The implementation is written independently in Python against the documented protocol. The OpenAI DevKit (Node SDK) is not vendored: its license is noncommercial.

## Consequences

- No CLI install. Sign-in is one browser round trip from Settings → ChatGPT.
- Clew, not Codex, owns conversation history and its size. Existing Codex-era conversations are imported once as labeled historical data on their next turn.
- Codex-era model and effort settings migrate to the plan default.
- The model catalog comes from `GET /v1/models` on the plan; its first listed model is the plan default.
- Learners control spend in ChatGPT Settings → Usage → App limits. A per-app limit can be reached while the plan still has usage.
- A hosted or paid Clew needs separate approval from OpenAI; this ADR covers the local edition.

## References

- [Sign in with ChatGPT](https://learn.chatgpt.com/docs/sign-in-with-chatgpt)
- [Integrating Sign in with ChatGPT (cookbook)](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)
- [Sign in with ChatGPT DevKit](https://github.com/openai/sign-in-with-chatgpt-devkit)
