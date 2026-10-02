# WebCommander SSH Guide

WebCommander can connect to remote servers through SSH and display a remote filesystem in either panel.

## Password authentication

1. Click `L: Local` or `R: Local` in the toolbar.
2. Enter the host, port, username, and password.
3. Select `Password` authentication.
4. Click `Connect`.

## SSH key authentication

1. Generate a key if needed:

```bash
ssh-keygen -t ed25519 -C "webcommander"
```

2. Copy the public key to the server:

```bash
ssh-copy-id user@server
```

3. Select `SSH Key` and paste the private key. Enter its passphrase when required.

## Security recommendations

- Prefer SSH keys over passwords.
- Protect private keys with a passphrase.
- Disable root login and password authentication where appropriate.
- Restrict SSH access with `AllowUsers` and a firewall.
- Use a non-default SSH port and keep OpenSSH updated.

## Panel operations

- `F5` copies selected items.
- Edit a remote text file by double-clicking it, then use `Ctrl+S` to save.
- `F6` moves selected items through the provider transfer service, including Local/SFTP and SFTP/SFTP transfers.
- Transfers stream through the backend and use the standard conflict/overwrite handling.
- SSH sessions are closed when a panel switches back to local mode.

Browser reload preserves owned live SSH sessions while the backend remains running.
Explicit logout closes the current web session's connections. SSH host-key verification
is not yet implemented; see [deployment limitations](DEPLOY.md#known-deployment-limitations).

## Panel terminal protocol

The browser uses `/api/terminal` over WebSocket with the authenticated web-session
cookie and a same-host Origin check. Each socket owns one shell. Initial message:

```json
{"type":"open","provider":"sftp","sessionId":"<owned-session>","cwd":"/home/example","cols":120,"rows":30}
```

For a local PTY, use `"provider":"local"` and omit `sessionId`. Subsequent messages
are `{"type":"input","data":"pwd\r"}`, `{"type":"resize","cols":120,"rows":30}` and
`{"type":"close"}`. Responses are `ready`, `output`, `error` and `exit`.
Dimensions are limited to 10–500 columns / 2–200 rows and messages to 64 KiB.
Reverse proxies must preserve Host (including port) and forward WebSocket upgrades.
The shell runs with the backend/remote user's permissions; path limits do not sandbox it.

## Troubleshooting

For connection refused errors, check the SSH service, port, and firewall. For authentication errors, verify the credentials or `authorized_keys` and check key permissions with `chmod 600 ~/.ssh/id_ed25519`.

The Russian version is available as [SSH_GUIDE.ru.md](SSH_GUIDE.ru.md).
