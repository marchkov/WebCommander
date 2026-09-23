# WebCommander Deployment Guide

## Docker deployment

1. Copy the project to the target host.
2. Create `.env` from `.env.example`.
3. Set a strong `WC_AUTH_PASSWORD` and `WC_SESSION_SECRET`.
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

The application is available on the port configured by `WC_PORT`.

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
