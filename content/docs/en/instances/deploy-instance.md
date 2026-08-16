---
title: Deploy an Agent instance
description: Complete an open-source Agent deployment from preflight through model, channel, resource, and readiness checks.
updatedAt: 2026-08-14
keywords:
  - instance deployment
  - preflight
  - Web channel
  - readiness
---

## Before deployment

Complete [Getting started](/docs/getting-started), then choose the correct [desktop, LAN, or server mode](/docs/installation/local-deployment).

Confirm that Docker, the data directory, port pool, and Docker network are available. Also confirm that `ENCRYPTION_KEY` and `MYBAY_INTERNAL_ROUTING_SECRET` are configured. Server mode additionally requires correct domains, Traefik, and HTTPS prerequisites.

> [!WARNING]
> An `internal_routing` failure usually means that the routing secret is missing or inconsistent. After correcting `.env`, rebuild the control plane and redeploy affected instances.

## Choose a starting point

Start from a suitable template or choose a blank deployment. Review the image, model, channels, resources, and access credentials before deployment. Use a recognizable name and never place API keys in names, descriptions, or ordinary environment fields.

## Configure the model and credential

Select a provider, model, and saved BYOK credential. The control plane decrypts the credential for instance configuration. If none is ready, see [BYOK model credentials](/docs/models/byok-credentials).

A custom compatible Base URL must be reachable from the Agent container network. Browser reachability alone does not prove container reachability.

## Choose communication channels

For initial verification, enable the Web channel:

- The internal chat API uses port `8642` by default.
- The optional Dashboard uses port `9119` by default.
- A reachable `9119` does not prove that chat on `8642` is ready.
- External channels require their own credentials and callback configuration.

Avoid enabling every external channel for the first test when only console chat is required.

## Set resources and access

CPU, memory, disk, and instance-count limits protect the local host. Tune them for the actual machine. Set a dedicated access account and strong password. In public-server mode, expose only required entry points through Traefik.

## Deploy and verify

Confirm that the task is not stuck, the Agent container reaches Running, chat readiness succeeds, the optional Dashboard is reachable, and console chat can exchange a test message. The instance URL and file behavior must match the deployment mode.

```bash
docker compose ps
docker compose logs --tail=200 mybay-local
docker ps -a --filter "name=mybay-agent"
```

A Running container is only a prerequisite. If chat remains unavailable, continue with [Common troubleshooting](/docs/troubleshooting/common).