# WebCommander

### Terminal backend (no terminal UI yet)

`/api/terminal` is a WebSocket endpoint on the same HTTP server. It reuses the
Express session cookie and requires login when authentication is enabled. Browser
Origin must match Host; reverse proxies must preserve Host and forward upgrades.
Each socket owns one shell. Send an initial JSON text message:

```json
{"type":"open","provider":"local","cwd":"D:/data","cols":120,"rows":30}
```

For SSH, use `"provider":"sftp"`, an existing `sessionId` belonging to the same
web session, and an absolute POSIX `cwd`. No SSH credentials are accepted here.
Then send `{"type":"input","data":"pwd\r"}`, `{"type":"resize","cols":120,"rows":30}`
or `{"type":"close"}`. Columns must be 10–500, rows 2–200. Replies are `ready`,
`output` (UTF-8 `data`), `error` (`message`) and `exit` (`code`, `signal`). `ready`
means the channel accepts input; on SSH the escaped initial `cd` has been queued.
Messages are limited to 64 KiB. Disconnect, shell exit and server shutdown clean
up the shell; heartbeat checks detect lost connections.

Local shells use node-pty (PowerShell preferred on Windows, `$SHELL`/bash/sh on
Unix). LocalProvider validates the initial cwd, including symbolic links. This
is **not a filesystem sandbox**: commands run with the server account's rights.
SSH uses a PTY channel on the existing connection; `/api/ssh/exec` is unchanged.
The Windows cleanup adapter includes a guarded workaround for node-pty 1.1's
ConPTY cleanup; recheck it when upgrading node-pty.

Linux installation requires Python, make and a C++ compiler for node-pty; the
Dockerfile installs these build dependencies. Backend tests mock PTYs by default.
To run the native smoke test in PowerShell:

```powershell
$env:WC_TEST_REAL_PTY = '1'
node --test server/services/terminalPty.integration.test.js
Remove-Item Env:WC_TEST_REAL_PTY
```

### ZIP archives

Select files or directories and choose **Pack to ZIP**. The suggested name is
`archive.zip`, or `<directory>.zip` for one selected directory. Names are preserved
relative to the selected items; binary files and empty directories are supported.
Select `.zip` files and choose **Extract here** to unpack into the current panel.
Both operations work with local and SFTP panels using backend streams.

Existing archives are never overwritten during creation. Extraction reports a
conflict by default; confirming overwrite replaces files, but never changes a
file into a directory or vice versa. The destination folder itself may exist.
On failure, files already extracted may remain; the panel refreshes to show them.
Creation inside a selected directory, ambiguous duplicate names, link cycles,
unsafe ZIP paths, and links escaping the extraction directory are rejected.

API: `POST /api/archives/create` accepts `{ provider, sessionId?, sources, destination }`;
`POST /api/archives/extract` accepts `{ provider, sessionId?, archive, destination, overwrite? }`.
Provider is `local` or `sftp`; SFTP requires `sessionId`. Overwrite defaults to false.

Backend checks: `node --test server/*.test.js server/providers/*.test.js server/services/*.test.js`.

A two-panel web file manager with local file operations, SSH connections, authentication, and an integrated text editor.

## Features

- Two-panel file management interface
- Local file browsing and operations
- SSH connections for remote servers
- Authentication and session protection
- Built-in text editor for local and SSH files
- Copy, move, rename, delete, upload, download, and ZIP operations
- Keyboard shortcuts: F5 copy, F6 move, F7 new folder, F8 delete
- Docker and Docker Compose support

## Requirements

- Node.js 18+ for a local installation
- Docker Desktop for containerized deployment

## Local development

```bash
npm install
node server/index.js
npm run dev
```

Open `http://localhost:3000` for the Vite development frontend. The production server uses port `3001` by default.

## Configuration

The application supports `config.json` and environment variables. Docker deployments should use `.env`.

Important variables:

- `WC_PORT` - application port
- `HOST_ROOT_PATH` - host directory mounted into the container
- `WC_ROOT_PATH` - filesystem root inside the container
- `WC_ALLOWED_PATHS` - comma-separated allowed paths
- `WC_BLOCKED_PATHS` - comma-separated blocked paths
- `WC_AUTH_ENABLED` - enable authentication
- `WC_AUTH_USERNAME` and `WC_AUTH_PASSWORD` - single-user credentials
- `WC_AUTH_USERS` - JSON array of users
- `WC_SESSION_SECRET` - session secret
- `WC_MAX_FILE_SIZE` - upload size limit in bytes

## Docker

The default Compose configuration mounts `D:/Example` to `/data/webcommander` and exposes port `3001`.

```bash
docker compose up -d --build
```

Open `http://localhost:3001` and sign in with the credentials configured in `.env`.

To stop the application:

```bash
docker compose down
```

See [DEPLOY.md](DEPLOY.md) for server deployment and [SSH_GUIDE.md](SSH_GUIDE.md) for SSH usage. Russian versions are available as [README.ru.md](README.ru.md), [DEPLOY.ru.md](DEPLOY.ru.md), and [SSH_GUIDE.ru.md](SSH_GUIDE.ru.md).

## Security

- Set a strong `WC_SESSION_SECRET`.
- Use a strong application password.
- Keep `WC_ALLOWED_PATHS` limited to the required directories.
- Keep system paths in `WC_BLOCKED_PATHS`.
- Use HTTPS behind a reverse proxy in production.
- Run the server as an unprivileged user.

## License

MIT
