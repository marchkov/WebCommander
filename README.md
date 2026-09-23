# WebCommander

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
