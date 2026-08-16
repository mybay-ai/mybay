---
title: Security practices for the open-source edition
description: Protect the local administrator session, BYOK credentials, Docker socket, instance files, and network entry points.
updatedAt: 2026-08-14
keywords:
  - security practices
  - administrator
  - ENCRYPTION_KEY
  - Docker socket
  - backup
---

## Define the trust boundary

MyBay Open Source uses one local administrator account. That administrator can manage credentials, instances, files, and system settings, so access should be limited to trusted operators.

Set a strong password immediately after first launch. For a public deployment, consider a VPN, IP allowlist, or another ingress control in addition to HTTPS. The session uses a protected cookie; avoid public computers and shared browser profiles.

## Protect keys and credentials

Model credentials are encrypted on the server with `ENCRYPTION_KEY`. `MYBAY_INTERNAL_ROUTING_SECRET` authenticates routes between the control plane and instances.

Never place these values in Git, public issues, chat transcripts, or screenshots:

- Real `.env` content.
- Model API keys.
- Administrator passwords, JWT secrets, or internal routing secrets.
- Requests containing Authorization headers.

To rotate a model key, create a replacement at the provider, update the saved MyBay credential, verify affected instances, and only then revoke the old key.

> [!DANGER]
> Do not replace `ENCRYPTION_KEY` directly. Existing credentials may become unreadable without a migration plan.

## Treat the Docker socket as privileged

The Docker socket provides extensive host privileges. Run the control plane only on a trusted host:

- Never expose the Docker daemon over public TCP.
- Never mount the Docker socket into an untrusted container.
- Enable only Docker management capabilities that are required.
- Review running containers, images, and unexpected port mappings regularly.

## Restrict network entry points

Each deployment mode has a different boundary:

- Desktop binds the console and dynamic ports to `127.0.0.1`.
- LAN binds to one trusted private address and relies on host firewall rules.
- Server mode exposes 80/443 through Traefik without publishing internal instance ports directly.

Public mode requires a real domain and valid HTTPS. Redeploy instances after switching modes so old URLs, bindings, and proxy labels are replaced.

## Protect files and backups

Instance files are available only through authenticated, path-validated endpoints. Do not expose the entire `data/` directory as public static content.

When backing up `.env` and `data/`, stop writes, use encrypted storage, restrict read access, retain the original `ENCRYPTION_KEY`, and test restoration regularly.

See [Files, preview, and local storage](/docs/workspace/files) for workspace boundaries.

## Respond to an incident

If a model credential leaks, revoke it at the provider, update MyBay, and redeploy affected instances. If an administrator password or environment key leaks, isolate the host, rotate affected secrets, and inspect logs.

Before opening a public issue, remove API keys, Authorization headers, real domains, internal addresses, user files, and routing secrets. Never upload a complete `.env`, database, or backup.