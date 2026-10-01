# WebCommander Deployment Guide

## Production authentication and sessions

Supply these variables to the server process (replace all placeholders):

```text
NODE_ENV=production
WC_AUTH_ENABLED=true
WC_AUTH_USERS=[{"username":"admin","password":"<strong-password>"}]
WC_SESSION_SECRET=<at-least-32-random-characters>
WC_COOKIE_SECURE=true
WC_TRUST_PROXY=1
WC_ALLOW_MEMORY_SESSION_STORE=true
WC_SESSION_COOKIE_NAME=webcommander.sid
WC_SESSION_MAX_AGE=86400000
WC_CORS_ORIGINS=
```

Production refuses missing/placeholder/short session secrets (minimum 32 characters), empty credentials, default `admin/***REMOVED***`, malformed users JSON, and MemoryStore without an explicit opt-in. A session secret must be supplied; it is never generated on startup. Development/test defaults remain available with warnings that do not reveal their values.

`WC_ALLOW_MEMORY_SESSION_STORE=true` is an acknowledgement for a single-process, single-instance deployment where memory-only sessions and session loss on restart are acceptable. It does not make MemoryStore suitable for multiple instances or large production workloads. No external session store is added in this release. Configured passwords remain plaintext; constant-time digest comparisons do not hash the stored configuration. Password storage/hashing is a separate future change.

Use HTTPS. `WC_COOKIE_SECURE` defaults to true in production and false elsewhere; an explicit env/config boolean overrides it. Cookies are HttpOnly and SameSite=Lax. Set `WC_TRUST_PROXY=1` only when there is one trusted reverse proxy and the backend cannot be reached through an untrusted route. It defaults to false; booleans and non-negative hop counts are supported. Secure cookies will not be issued over plain HTTP without a trusted HTTPS proxy. See the [Express session documentation](https://expressjs.com/en/resources/middleware/session/).

Environment values override corresponding config settings. User resolution is `WC_AUTH_USERS`, then `config.auth.users`, then the explicit single-user `WC_AUTH_USERNAME`/`WC_AUTH_PASSWORD` fallback. Production never invents a fallback user. To override configured users, set `WC_AUTH_USERS`. Security settings in config live under `auth`: `cookieSecure`, `trustProxy`, `cookieName`, `allowMemorySessionStore`, and `corsOrigins`.

Leave `WC_CORS_ORIGINS` empty for same-origin deployment. If needed, supply comma-separated exact origins such as `https://files.example.com,https://dashboard.example.com`; wildcard origins are rejected and unknown origins receive no credentialed CORS headers. SameSite=Lax still applies, so this is not a guarantee of third-party cookie access. HTTP and terminal WebSocket upgrades use the same session middleware; WebSockets retain their same-host Origin restriction.

Docker images contain neither `config.json` nor default credentials/secrets. Configure through environment variables, or explicitly mount your own config file read-only. Native Node startup does not automatically load `.env`; export variables or provide them through systemd/your process manager. Login rotates the session ID. Logout closes owned SSH connections, destroys the session and expires its cookie.

## Docker deployment

1. Copy the project to the target host.
2. Create `.env` from `.env.example`.
3. Set `WC_AUTH_USERS`, a random `WC_SESSION_SECRET`, and the production options above. `.env.example` intentionally cannot start production until configured.
4. Set `HOST_ROOT_PATH` to the host directory that should be managed.
5. Start the application:

```bash
docker compose up -d --build
```

Check the service:

```bash
docker compose ps
docker compose logs -f webcommander
```

Serve the application through the HTTPS reverse proxy on the port configured by `WC_PORT`.

## Native Linux deployment

```bash
npm install
npm run build
NODE_ENV=production node server/index.js
```

For a persistent service, use PM2 or systemd. Run the process as an unprivileged user and limit `allowedPaths` to the required directories.

## Nginx reverse proxy

Use HTTPS and proxy traffic to `http://127.0.0.1:3001`:

```nginx
server {
    listen 443 ssl http2;
    server_name files.example.com;

    ssl_certificate /etc/letsencrypt/live/files.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/files.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 100M;
    }
}
```

## Updating

```bash
git pull
npm install
npm run build
docker compose up -d --build
```

## Troubleshooting

- Check application logs with `docker compose logs -f webcommander`.
- Check the port with `docker compose ps`.
- Verify host path sharing in Docker Desktop.
- Verify permissions for the configured root directory.
- Confirm that `WC_ALLOWED_PATHS` contains the same container path as `WC_ROOT_PATH`.

The Russian version is available as [DEPLOY.ru.md](DEPLOY.ru.md).
