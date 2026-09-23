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
- Cross-mode move is not supported; use copy and delete.
- SSH-to-SSH transfer between different hosts is not currently supported.
- SSH sessions are closed when a panel switches back to local mode.

## Troubleshooting

For connection refused errors, check the SSH service, port, and firewall. For authentication errors, verify the credentials or `authorized_keys` and check key permissions with `chmod 600 ~/.ssh/id_ed25519`.

The Russian version is available as [SSH_GUIDE.ru.md](SSH_GUIDE.ru.md).
