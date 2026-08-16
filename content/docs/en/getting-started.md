---
title: Getting started
description: Start MyBay Open Source locally, sign in as the administrator, and prepare your first Agent deployment.
updatedAt: 2026-08-14
keywords:
  - getting started
  - Docker Compose
  - local deployment
  - Agent
---

## Before you start

Install Docker Desktop, or Docker Engine with Docker Compose v2. Make sure the Docker daemon is running and execute the launcher from the project root.

> [!NOTE]
> MyBay Open Source is a single-administrator, local-first control plane. Accounts, instance configuration, and encrypted credentials stay on your host.

## Run the quick-start launcher

Windows PowerShell:

```powershell
.\quick-start.ps1
```

Linux or macOS:

```bash
chmod +x quick-start.sh
./quick-start.sh
```

The launcher checks Docker, creates or completes `.env`, generates security secrets and an administrator password, then starts the services with Docker Compose. Existing valid configuration is preserved.

To access MyBay from another device on your LAN, read [Local and server deployment](/docs/installation/local-deployment). Do not simply change the bind address to `0.0.0.0`.

## Sign in to the local console

The default console URL is:

```text
http://localhost:3000
```

The administrator username comes from `LOCAL_ADMIN_USERNAME` in `.env` and defaults to `admin`. The quick-start launcher stores the generated password in the local `.env` file. Never commit or share that file.

## Add a BYOK model credential

The open-source edition uses your own model API key. After signing in, open Credentials, add a provider credential, and select it when deploying an instance.

See [BYOK model credentials](/docs/models/byok-credentials) for field details, security guidance, and custom base URLs.

## Deploy your first Agent

1. Open New Deployment.
2. Choose a template or a blank deployment.
3. Select a provider, model, and saved BYOK credential.
4. Use the Web channel for the first validation.
5. Configure an instance access username and independent password.
6. Review the configuration and start deployment.

Wait until the instance reports a runnable or chat-ready state before opening its workspace and sending a test message.

## Verify runtime status

```bash
docker compose ps
docker compose logs --tail=200 mybay-local
```

If the control panel works but an instance does not start, check Docker socket permissions, model credentials, host resources, and Agent container logs.

## Next steps

- Choose [desktop, LAN, or public-server deployment](/docs/installation/local-deployment).
- Configure and rotate [BYOK model credentials](/docs/models/byok-credentials).
- Create an instance and verify Web chat from the console.
