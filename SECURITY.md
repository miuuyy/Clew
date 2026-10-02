# Security

Clew 1.0.0 is a local desktop application. It does not host your workspace on clew.my.

The Electron renderer is sandboxed, with context isolation, no Node integration, restricted IPC, and no embedded external browser windows. Its stable `clew://app` origin serves only local bundle files and forwards authenticated API requests to the owned random loopback endpoint. The bundled backend requires a private per-launch session for API access. Workspace requests also require an authenticated ChatGPT connection with plan usage permission.

OAuth uses PKCE, state, nonce, issuer/audience checks and verified ID-token signatures. Credentials stay in the OS store. The frontend receives only the local launch session, never OpenAI tokens. Requests to OpenAI use `store: false`; the scoped graph context and conversation still leave the device when you use AI.

Graph mutations remain validated, reviewed and snapshot-backed. Report suspected violations, credential exposure, or unauthorized local API access through [GitHub private vulnerability reporting](https://github.com/miuuyy/Clew/security/advisories/new). Do not post tokens, OAuth callback URLs, or personal graph data in a public issue.

The first release is ad-hoc signed on macOS and unsigned on Windows. This does not provide verified publisher identity or macOS notarization.

Native export IPC accepts only the current owned top-level frame. Export paths
cannot traverse directories or use symlinks; publication is atomic and never
replaces an existing export. Browser permissions are denied. AppImages require
working user namespaces and never retry with a disabled sandbox. Updates are
manual installer downloads; the app does not silently download or execute them.

The local OS account and application binaries are trusted. The launch token does
not protect against malware already running as that user. Before reporting logs,
remove personal workspace content as well as credentials.
