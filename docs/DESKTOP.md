# Desktop app

Clew 1.0.0 ships an Electron window, the existing React graph UI, and a bundled Python backend. The backend runs only on `127.0.0.1`, on a port assigned for that launch. The UI and its API use the stable secure `clew://app` origin through Electron, so themes and view preferences survive restarts. Closing the app stops its backend.

## Install

Get the native installer from [Releases](https://github.com/miuuyy/Clew/releases/latest). Compare its SHA-256 with `SHA256SUMS` from the same release if you want to verify the download.

- **Windows x64:** run the installer. Installation is per-user; WSL is not required.
- **macOS 13+:** choose Apple Silicon or Intel. Open the DMG and drag Clew to Applications, or unpack the ZIP.
- **Linux:** choose x64 or arm64. Debian installation is system-wide; data remains per-user. AppImage requires FUSE 2 and working unprivileged user namespaces; make it executable and run it as your user. Use the Debian package on distributions that restrict AppImage namespaces. Linux also needs a desktop session with Secret Service and D-Bus for credential storage. CI baselines are Ubuntu 22.04 x64 and Ubuntu 24.04 arm64.

macOS builds are ad-hoc signed, without Apple Developer ID notarization. Windows builds are not Authenticode signed. The OS can show an unidentified-publisher warning. No release script disables platform protections.

Select **Continue with ChatGPT**, finish sign-in in your browser, and allow Clew to use your Plus or Pro plan. Return to the app. Cancelling or refusing permission leaves it on the sign-in screen. GitHub/X support actions are optional.

## Local data

Use **Help → Open Data Folder** to locate your installation's data. Default locations:

| System | Application data |
| --- | --- |
| Windows | `%APPDATA%\clew\data` |
| macOS | `~/Library/Application Support/clew/data` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/clew/data` |

`knowledge_graph.sqlite3` stores the workspace, snapshots, chats and quizzes.
`chatgpt-registration.json` stores the issued client ID, verified account label,
and installation ID. Access/refresh tokens are stored in Keychain, Windows
Credential Locker, or Secret Service. The desktop credential entry is derived
from the resolved database path, so separate data directories and smoke profiles
have independent, stable credentials.

The desktop app has its own data directory. It does not overwrite a source checkout's `backend/data`. Move graphs between editions through graph export/import. Back up the complete data directory while the app is closed. Sign-out and uninstallation preserve the data.

Use **Help → Open Logs** for startup diagnostics. Logs must not contain OAuth codes, tokens, or the private launch session. Report errors with your platform, Clew version, and redacted relevant log entries.

The launcher sets `KG_DEBUG_LOG_DIR` to the writable `backend` directory inside
Electron's log folder. It never writes diagnostics into the application bundle.

**Help → Check for Updates** checks the latest stable GitHub Release and verifies
that an installer exists for this platform and architecture. Select **View
Release**, download the installer, close Clew and replace the application.
Local data is retained. Updates are installed manually on every platform; no
automatic download or in-app installation is claimed. An unavailable release or
failed check is reported explicitly. macOS's native automatic updater requires
a suitable signing identity; see [Electron's update requirements](https://www.electronjs.org/docs/latest/api/auto-updater#macos).

## Development

For browser development on macOS/Linux, use `./scripts/dev.sh`. For Electron development, first set up `.venv`, install the backend and frontend, then run `npm ci && npm run dev`.

Use Node 22.22.2 or newer. CI packaging uses Python 3.12.

Native Windows PowerShell:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python -m pip install -e backend -r desktop/requirements.txt
npm ci
npm --prefix frontend ci
npm run dev
```

Native macOS/Linux:

```bash
python3.12 -m venv .venv
./.venv/bin/python -m pip install -e backend -r desktop/requirements.txt
npm ci
npm --prefix frontend ci
npm run dev
```

## Build and verify

```bash
npm run package
npm run smoke:package
```

Build on the matching OS and architecture: PyInstaller embeds a native Python runtime. Cross-compiling only the Electron window does not produce a usable backend. Set `CLEW_PYTHON` when using an environment other than `.venv`.

The release workflow builds Windows x64, macOS arm64/x64, and Linux x64/arm64.
Each job checks the native package, onboarding, stable storage, renderer isolation,
API boundary, export helper and shutdown. macOS signatures are verified. Linux
requires prepared native tools before packaging; see
[release validation](DESKTOP_RELEASE_VALIDATION.md). Tag builds prepare a draft
only after all jobs and artifact validation pass. The owner publishes it.
Assets include checksums, startup receipts and screenshots. Third-party Python,
JavaScript and native-library notices are bundled under `resources/LICENSES`;
Electron retains its own license files.

A packaged smoke check does not prove authenticated inference. Authentication/proposal tests use an explicit isolated test peer; real account consent and plan availability require a live sign-in. No test peer is bundled as a production provider.
