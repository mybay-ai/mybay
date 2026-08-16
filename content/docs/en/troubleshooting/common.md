---
title: Common troubleshooting
description: Diagnose launcher permissions, container state, instance URLs, internal routing, the chat API, and asynchronous runs.
updatedAt: 2026-08-14
keywords:
  - troubleshooting
  - BEGIN_TURN_FAILED
  - UPSTREAM_RUN_NOT_FOUND
  - chat readiness
  - internal_routing
---

## The launcher is not executable

If Linux or macOS reports `quick-start.sh: Permission denied`:

```bash
chmod +x quick-start.sh
./quick-start.sh
```

You can also run `bash quick-start.sh`. If it still fails, confirm that the current directory is the project root and that Docker is running.

## The control-plane container exits

Collect status and recent logs:

```bash
docker compose ps
docker compose logs --tail=200 mybay-local
```

Common causes include missing `.env` values, a port conflict, an unwritable data directory, unavailable Docker socket access, or malformed security keys. Correct the issue and rebuild with the original deployment mode.

## An instance URL is unreachable

`agent-xxx.localhost` is available only from the Docker host. Other local-network devices require LAN mode. A public server requires server mode with a real domain and HTTPS.

Redeploy old instances after switching modes. Restarting containers alone does not replace generated URLs, port bindings, or Traefik labels.

## The internal_routing check fails

`Routing secret missing` or an `internal_routing` failure means `MYBAY_INTERNAL_ROUTING_SECRET` is absent, malformed, or inconsistent.

Correct `.env`, rebuild the control plane, redeploy affected instances, then rerun preflight and chat readiness. Never copy the real secret into logs or issues.

## CHAT_API_NOT_ENABLED

This error means the instance did not enable its internal chat API. Confirm that generated configuration includes:

```text
API_SERVER_ENABLED=true
API_SERVER_PORT=8642
```

Redeploy after correcting it. A healthy Dashboard on `9119` does not prove the chat API is enabled.

## BEGIN_TURN_FAILED

This error means the control plane could not initialize a chat turn. Check the administrator session, chat readiness, the `8642` listener, BYOK credentials, data-directory write access, and control-plane and Agent logs from the same time window.

After correcting configuration, send one new test message rather than repeatedly submitting the same large request.

## UPSTREAM_RUN_NOT_FOUND

This error means an asynchronous run tracked by the control plane no longer exists at the Agent. It can follow an instance restart, upstream expiry, or state divergence.

Some saved output may remain. Refresh the conversation and inspect task details. If the run cannot recover, submit the request again. If it repeats, check for frequent instance restarts and verify time, network, and runtime health on both sides.

## File or capacity problems

Confirm that the file remains inside the current instance workspace and did not trigger a path, type, or sensitive-content restriction. When storage is low, remove unneeded logs, caches, and generated files after backing up deliverables.

See [Files, preview, and local storage](/docs/workspace/files).

## Before filing an issue

Retain the error code, time, deployment mode, container state, and redacted logs. Remove API keys, passwords, Authorization headers, cookies, complete `.env` content, real domains, private addresses, user files, and internal routing secrets.