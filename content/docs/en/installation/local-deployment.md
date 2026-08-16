---
title: Local and server deployment
description: Choose desktop-only, LAN, or public-server mode and configure addresses and ports correctly.
updatedAt: 2026-08-14
keywords:
  - local deployment
  - LAN
  - Traefik
  - HTTPS
---

## Requirements

- Docker Desktop, or Docker Engine 24+
- Docker Compose v2
- At least 2 CPU cores, 4 GB of memory, and 10 GB of free disk space
- Access to `/var/run/docker.sock` from the control-panel container

> [!WARNING]
> The Docker socket grants substantial host privileges. Run the control plane only on a trusted host and protect the administrator account and `.env`.

## Desktop-only mode

Windows:

```powershell
.\quick-start.ps1
```

Linux or macOS:

```bash
./quick-start.sh
```

The console and dynamic Agent ports bind only to `127.0.0.1`. Open `http://localhost:3000`. Instance addresses under `.localhost` are available only from the Docker host.

## LAN mode

Linux or macOS:

```bash
./quick-start.sh --lan 192.168.1.20
```

Windows:

```powershell
.\quick-start.ps1 -Mode lan -LanBindIp 192.168.1.20
```

Use the Docker host's real LAN address, not `0.0.0.0`. Permit the console port and, when required, the dynamic range from `MY_BAY_PORT_START` through `MY_BAY_PORT_END` in `.env`.

## Public-server mode

Prepare a control-panel domain, an Agent root domain, a certificate email address, and public TCP ports 80 and 443.

```bash
./quick-start.sh --server
```

```powershell
.\quick-start.ps1 -Mode server
```

This mode starts Traefik through `docker-compose.server.yml`, obtains HTTPS certificates, and keeps dynamic Agent ports off public interfaces.

## Manual Docker Compose

```bash
cp .env.example .env
# Set the administrator password and generate JWT_SECRET, ENCRYPTION_KEY,
# and MYBAY_INTERNAL_ROUTING_SECRET.
docker compose up -d --build
```

For server mode:

```bash
docker compose -f docker-compose.yml -f docker-compose.server.yml up -d --build
```

Use the quick-start launcher for a first installation so required secrets, domains, and proxy variables are not missed.

## Switch deployment modes

1. Rerun the launcher with the target mode.
2. Rebuild the control-panel container.
3. Redeploy existing Agent instances.
4. Verify console URLs, instance addresses, and firewall rules.

A mode change affects port bindings, instance URLs, and Traefik labels. Restarting old containers alone is not sufficient.

## Backup and upgrade

`.env` contains security keys. `data/` contains the control-plane database, instance configuration, and workspaces. Stop writes and back up both before upgrading.

```bash
docker compose stop
docker compose up -d --build
```

Do not change `ENCRYPTION_KEY` without a credential migration plan, or existing encrypted API keys may become unreadable.

## Diagnostics

```bash
docker compose ps
docker compose logs --tail=200 mybay-local
docker ps -a --filter "name=mybay-agent"
```

For server mode, also inspect:

```bash
docker compose -f docker-compose.yml -f docker-compose.server.yml logs --tail=200 traefik
```
