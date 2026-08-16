# Security Policy

## Supported Edition

This repository contains MyBay Open Source, the self-hosted community edition of MyBay.

The open-source edition is designed for trusted development machines and private servers. For public servers, use the built-in Traefik server mode with HTTPS and strong local-administrator credentials. Add a VPN, IP allowlist, or another authentication layer when your threat model requires it.

## Reporting a Vulnerability

Please do not report vulnerabilities in public GitHub issues.

Send a private report to:

- security@mybay.ai

Include:

- Affected version or commit
- Reproduction steps
- Impact and affected component
- Whether secrets, files, instance ownership, or model credentials can be accessed
- Any suggested fix

## Secret Handling Rules

Never commit:

- `.env`
- `data/`
- API keys or provider tokens
- Docker registry tokens
- Webhook secrets
- Real deployment domains or callback URLs
- Uploaded files, logs, sessions, or database dumps

## Expected Security Boundaries

- Model provider API keys must not be sent to the browser after storage.
- Instance file APIs must validate instance ownership and safe paths.
- Downloads and previews must prevent path traversal.
- Admin-only APIs must check the local administrator session.
- The open-source edition stores all platform data on the current machine and must not require hosted platform credentials.

## Docker Socket and Public Exposure

The Control Plane mounts `/var/run/docker.sock` to create and manage Agent containers. This access grants high-privilege control over the Docker daemon and can be equivalent to host-level administrative capability. Treat every MyBay administrator account as a privileged host administrator.

For an internet-facing deployment:

- Set a strong, unique `LOCAL_ADMIN_PASSWORD` and secure production secrets.
- Place the Control Plane behind a hardened reverse proxy with HTTPS.
- Prefer a VPN, private network, or IP allowlist.
- Do not expose the Control Plane directly to the public internet without protection.

MyBay Open Source is local-first, but configured AI providers, message channels, and other third-party integrations may receive necessary data according to the administrator's configuration and their own security terms.