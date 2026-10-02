# Desktop release validation

Clew 1.0.0 targets Windows x64, macOS arm64/x64 and Linux x64/arm64. Build each on
its matching host. PyInstaller and Electron must use the same architecture.
`before-pack.cjs` rejects a version, OS or architecture mismatch.

## Integration contract

The launcher supplies:

- `KG_DB_PATH`: `<userData>/data/knowledge_graph.sqlite3`
- `KG_DESKTOP_TOKEN`: a new private random session per launch
- `KG_FRONTEND_ORIGIN=clew://app`: preserved by `backend/desktop_entry.py`
- `KG_DEBUG_LOG_DIR=<Electron logs>/backend`: always writable
- `KG_API_PORT`: assigned by the backend before constructing settings

The backend watches its launcher-owned stdin pipe. EOF requests graceful uvicorn
shutdown, both on ordinary quit and parent-process failure. The launcher sends
EOF, waits five seconds and logs any forced termination; packaged smoke requires
an exit without that force path. This contract is also required on Windows.

Desktop credentials use `desktop-{sha256(db_path.resolve())[:32]}` as their OS
store entry. The key is stable for one data directory and isolated between user
data and smoke directories. Browser source development retains its separate
`connection` namespace. Development tooling requires Node 22.22.2+.

The renderer bridge exposes `apiBase=clew://app`, the private launch session,
version, platform, `openExternal(url)` and
`exportObsidian(package): Promise<boolean>`. Export returns `false` only when the
native picker is cancelled; the frontend must carry that cancellation through to
its export action. Other failures reject. Browser export remains File System
Access.

Electron serves bundle files and proxies same-origin `/api/v1/` requests to its
owned loopback backend. It requires the application initiator and session header,
strips unrelated request headers, forbids redirects and preserves streams.
Backend CORS names the exact application origin, never `*` or `null`. OAuth
continues to use the actual HTTP loopback callback.

Backend HTTP uses one Node global `fetch` implementation shared by production and
the native protocol test peer. Electron `net.fetch` serves local bundle files
only. There is no alternative backend transport or retry through another API.

The canonical SVG and native asset generator belong to the frontend/asset owner.
`build-backend.cjs` calls `desktop/assets/build.cjs` before packaging.

## Automated gates

```bash
npm run check:version
npm run test:desktop
npm run package
npm run smoke:package
```

Desktop tests cover origin/frame checks, bundle containment, API forwarding,
export traversal/collision/symlink rejection, real native no-replace commits,
release hashes and manual update failure handling. The electron-builder config
must pass its schema validation.

Each packaged smoke launches twice with one isolated data directory. It checks
the ready accessible onboarding CTA, optional GitHub/X links, secure fixed origin,
renderer isolation, exact CORS preflight, protected loopback API, renderer API
access, localStorage persistence, packaged atomic export and backend shutdown.
No account, graph or credential from the user's installation is used. Failed
smokes retain their temporary diagnostics.

macOS verifies the ad-hoc signature of both the app bundle and the app extracted
from its release ZIP. `identity: '-'`, no notarization, and disabled automatic
identity discovery prevent an unrelated installed identity from being chosen.

Linux installs and smokes the real Debian package. AppImage extraction checks
native ELF architecture, required libnotify symbols, dependency resolution and
the exact Clew AppRun. A runner with working unprivileged user namespaces also
smokes that AppRun. On a runner that restricts namespaces, the installed Debian
smoke and AppImage ABI checks are the gates; this does not claim AppImage launch
coverage on that runner.

Release collection verifies actual SHA-512 hashes and sizes against updater
metadata, rejects duplicates/traversal/mixed versions, merges macOS metadata
deterministically and requires all nine installers/archives, four manifests and
five successful final smoke receipts/screenshots. It stages the output only
after validation. SHA256SUMS covers the resulting release assets. Tag runs
prepare a draft; the owner publishes it after integration and live validation.

## Linux native tools

CI baselines are Ubuntu 22.04 x64 and Ubuntu 24.04 arm64. Debian installation is
system-wide; data and credentials remain per-user. AppImages require FUSE 2,
a desktop session and unprivileged user namespaces. Use the Debian package when
a distribution restricts the latter. Clew never retries without its sandbox.

Install native fpm 1.17.0, Ruby development files, build-essential, Meson, Ninja,
pkg-config, binutils, GLib/GdkPixbuf headers and the Electron desktop libraries.
Then run:

```bash
node desktop/scripts/prepare-linux.cjs
export APPIMAGE_TOOLS_PATH="$PWD/desktop/build/appimage-tools"
export USE_SYSTEM_FPM=true
npm run package
node desktop/scripts/verify-linux.cjs
```

Preparation compiles checksum-pinned libnotify 0.8.7 and verifies the symbol
required by Electron. Its LGPL license and complete source archive are bundled.
The AppImage toolset is copied into an owned build directory; shared caches are
never patched. Native fpm avoids a bundled Ruby binary with a newer host ABI.

The custom AppRun and empty `appImage.executableArgs` deliberately replace
electron-builder's generated sandbox-disabling launch behavior. They are checked
in the extracted final artifact.

## Live checks before publication

Packaged startup is not authenticated inference. Record version, OS, CPU,
installer format, clean/upgrade path and the outcome of these checks:

1. Complete real ChatGPT sign-in and plan consent in the system browser.
2. Send a message, receive a streamed answer, review and apply a proposal.
3. Restart; confirm graph, theme, view and conversation state survive.
4. Export an Obsidian folder; confirm cancellation, repeat-export rejection and
   opening the complete result in Obsidian.
5. Sign out; confirm access locks and local data remains.
6. Install a newer release over the existing app and confirm retained data.
7. Check native menus, focus, zoom, close/quit, external links and log locations.

Windows and Linux live-account behavior and installer upgrades need their native
machines. Record unexecuted checks explicitly. Signing limitations do not block
building; do not substitute unrelated credentials or claim publisher trust.

## Reference comparison

The user-owned `References/codex-chatgpt-web` provides useful release discipline:
matching native runtimes, isolated smoke data, real installed-package/signature
checks, explicit account-bound gates and checked dependency ABI. Clew retains its
existing graph UI and native window design. Its fixed application protocol,
system-browser OAuth and per-user SQLite repository are Clew-specific boundaries.
The reference's embedded browser, runtime supervisor and model-routing machinery
are not dependencies of Clew.
