# Clew 1.0.0 validation

Validated on 2 October 2026. The existing graph workspace is preserved; the desktop host, required ChatGPT entry, lifecycle, packaging and documented boundaries are new.

## Local evidence

- 142 backend tests, 119 frontend tests and 20 desktop contract tests pass. TypeScript, localization, versions, workflow syntax and dependency audits pass.
- The macOS arm64 package launches twice with isolated data. Secure `clew://app` origin, private API access, storage persistence, native atomic export, sandbox and graceful backend shutdown pass.
- The actual SVG loads and stays white on black onboarding, including when a light workspace preference was saved. Native icons derive from the same SVG.
- Real ChatGPT authorization, a five-model catalog and a completed assistant reply were verified with the public mathematics demo. Its graph snapshot stayed unchanged.
- Baseline comparisons preserve graph anchors on 80 generated DAGs and exact positions/velocities across 1,200 physics frames.
- Separating API transport from math rendering reduces initial JavaScript from approximately 490 KB to 216 KB. Markdown and math load with the workspace; 3D rendering loads when selected.

## Native release gates

The [release workflow](../.github/workflows/release.yml) builds Windows x64, macOS arm64/x64 and Linux x64/arm64 on matching hosts. Each job runs the tests and packaged startup checks. Release collection rejects missing targets, failed receipts and checksum mismatches before preparing a draft. The final receipts and screenshots accompany the release.

Linux also validates AppImage architecture, dependencies, libnotify and its sandbox-preserving launcher, and launches the installed Debian package. AppImage launch coverage is recorded when the runner permits user namespaces. macOS verifies the application and extracted ZIP signatures.

macOS signing is ad-hoc without Apple notarization; Windows is unsigned. Automated package startup does not establish authenticated inference on Windows or Linux. See [desktop requirements](DESKTOP.md) and [build contracts](DESKTOP_RELEASE_VALIDATION.md).
