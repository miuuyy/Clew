# ADR 0007: Desktop distribution and required ChatGPT sign-in

- Status: accepted
- Date: 2026-10-02
- Updates: ADR 0006 entry/access policy

## Decision

Clew 1.0.0 ships as an Electron desktop app for Windows, macOS and Linux. It preserves the React/Three.js graph UI and Python repository/agent core. Python is packaged as a native executable, not downloaded or installed at user runtime.

The launcher binds one backend to a random loopback port. A per-launch token protects API access; only the owned renderer receives it through the isolated preload. The renderer is sandboxed and has no Node integration. OAuth and external links open in the system browser.

ChatGPT sign-in and plan usage permission are required before mounting the workspace. The backend enforces the same access rule. Signing out locks the interface and retains local data. X/GitHub actions on onboarding are optional, with no verification or entitlement effects.

Each desktop installation stores graphs under Electron's application-data directory and credentials in the OS store. Development checkout data is separate. No source database is moved, rewritten, or imported implicitly.

Native builds run on each target OS/architecture. Publication depends on tests and packaged startup verification for all targets. Ad-hoc macOS signatures and unsigned Windows packages are stated explicitly; the release does not claim notarization or publisher certification.

The future ChatGPT web plugin remains a separate surface sharing the graph core. It is not part of the desktop runtime or 1.0.0 release.
