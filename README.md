# WebCommander

A two-panel web file manager with Local and SSH/SFTP support, a text viewer/editor,
ZIP operations and an independent terminal in each panel.

[Русский README](README.ru.md)

## Features

- Browse, copy, move, rename and delete files and directories across Local and SFTP panels.
- View text with **F3**, edit with **F4**, and create a file with **Shift+F4**.
- Use **↑/↓**, **Enter**, **Backspace** and **Tab** to navigate; **F5/F6/F7/F8** copy/move/create a directory/delete; **Shift+F6** renames.
- **Pack to ZIP** and **Extract here** support binary files, empty directories and mixed selections.
- Connect with an SSH password or key, manage connections and recover live sessions after a page reload.
- Open **>_** in either panel for a Local PTY or SSH shell; **Ctrl+T** toggles the active panel's terminal.
- Download files/directories and use provider APIs for size-limited uploads.

Local files are on the **backend host**, not the browser's computer. SSH panels
use POSIX paths and SFTP streams through that backend. Cross-provider copy/move
works between Local and SFTP and between SFTP connections. FTP is not implemented.

## Requirements

- A supported Node.js LTS release and npm. Native terminal builds on Linux require Python, make and a C++ compiler.
- Docker/Compose is an alternative; see [deployment instructions](DEPLOY.md).

## Quick start

```bash
git clone https://github.com/marchkov/WebCommander.git
cd WebCommander
npm ci
cp config.example.json config.json
mkdir -p data
```

On Windows, use `Copy-Item config.example.json config.json` and create the `data`
directory. If you already have a local config, keep it rather than copying over it.

Configure your local `config.json`: replace the username/password placeholders,
set a random session secret of at least 32 characters, and choose your data paths.
For **local HTTP only**, set `auth.cookieSecure` to `false`. The example deliberately
cannot start production unchanged. Local config and `.env*` files are ignored;
only safe examples are committed. `WC_*` environment variables override config.
Native Node startup does not load `.env` automatically.

Start a local application with the built frontend:

```bash
npm run build
bash start.sh
```

On Windows use `start.bat`. Open `http://localhost:3001` and sign in with your
configured credentials. Both launchers default to local development and loopback.
Use [DEPLOY.md](DEPLOY.md) for production authentication, HTTPS, proxy and session settings.

For frontend development, run `node server/index.js` in one terminal and
`npm run dev` in another, then open `http://localhost:3000`.
If the backend is unavailable, the client can fall back to sample/demo data;
demo actions do not operate on real files.

## Everyday behavior

**F3** opens the existing editor read-only; saving is disabled. **F4** and file
double-click open Edit. Ctrl/Cmd-click preserves multiple selection. **Ctrl+F**
opens Connections; **Insert** toggles the current item and advances. Panel terminals
keep their starting directory when the file list navigates elsewhere. Close/reopen
or Reconnect starts a new shell in the panel's current directory.

Rename, new-file creation, upload and ZIP creation do not silently overwrite
existing entries. Copy/move and extraction report conflicts and can explicitly
overwrite files; file/directory type mismatches remain conflicts. Failed extraction
may leave files already extracted. Upload limits/extensions are configurable in
[DEPLOY.md](DEPLOY.md); editing an existing file is independent of extension restrictions.

SSH recovery requires the same live browser session and running backend. Restarting
the backend ends its in-memory connections. Logout disconnects only that web
session's SSH connections. See [SSH_GUIDE.md](SSH_GUIDE.md) for connection details.

## Security

Use HTTPS for production, explicit credentials and a random session secret. Run
the backend as an unprivileged user and restrict `allowedPaths`/`blockedPaths`.
Browser writes and login enforce Origin/Fetch Metadata checks; SSH connections
are owned by their web sessions. ZIP extraction rejects escaping paths and uploads
validate filenames, destination paths, size and extension.

**Terminals execute commands with the backend user's or remote SSH user's permissions.**
LocalProvider path limits validate the starting directory; they do **not** sandbox
the terminal or isolate the filesystem. Deploy for trusted users, not untrusted
multi-tenant access. Existing limitations include plaintext configured passwords,
an opt-in in-memory session store and no SSH host-key verification/pinning; see
[DEPLOY.md](DEPLOY.md) before exposing the application.

## Development checks

```bash
npm ci
npm run typecheck
npm run build
node --test server/*.test.js server/providers/*.test.js server/services/*.test.js tests/*.test.cjs
npm audit
```

Set `WC_TEST_REAL_PTY=1` to include native PTY smoke tests; CI enables them.
Windows may skip symlink tests when the required privilege is unavailable.
SFTP tests use adapters, not a real external SSH server.

## License

[MIT License](LICENSE) — Copyright (c) 2026 Denis Marchkov.
