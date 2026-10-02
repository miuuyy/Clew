# ADR 0008: Stable desktop origin and atomic native exports

- Status: accepted
- Date: 2026-10-02
- Updates: ADR 0007 desktop transport and native export boundary

## Context

A random backend port is appropriate for private loopback ownership. Using it as
the renderer origin creates a new localStorage namespace each launch, losing UI
preferences. A fixed TCP port introduces conflicts and does not define a stable
application identity. Browser folder-picker availability also cannot be assumed
in Electron.

## Decision

Register `clew` as a standard, secure, CORS-enabled scheme with Fetch and streaming
support, without bypassing CSP. The only application authority is `clew://app`.
Serve frontend files from the bundle after decoded-path and realpath containment
checks. Reject traversal, symlink escapes, other authorities and external
initiators. There is no network or SPA fallback for missing files.

The renderer uses `clew://app` for API calls too. Electron forwards only
`/api/v1/` requests initiated by that origin with the private launch session to
the owned random loopback endpoint. Requests and responses remain streamed;
redirects fail. CSP permits same-origin connections. OAuth callbacks retain their
real HTTP loopback address and run through the system browser.

IPC requires the owned webContents and its current top-level application frame.
Native Obsidian export validates the package before presenting a directory
dialog. It rejects nonportable paths, traversal, duplicate/case/Unicode collisions,
symlink parents and existing destinations. Files are written into a new private
staging directory. A small bundled filesystem helper publishes it with the OS's
atomic no-replace rename; Node's check-then-rename cannot guarantee this on POSIX.
Cancellation returns `false`; success returns `true`; failures reject explicitly.

## Consequences

UI preferences survive backend restarts and app upgrades within the same data
directory. No renderer loopback permission or general filesystem bridge is
granted. The backend launch contract includes the fixed frontend origin and a
writable debug-log directory. Browser development keeps its ordinary HTTP origin
and File System Access export path.

Export never merges into or overwrites an existing vault. Its native helper is
built on each matching target and included in signature and packaged smoke
checks. A crash can leave an uncommitted staging directory, but never a partially
published export. ADRs 0001–0007 remain historical records.
