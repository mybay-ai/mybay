---
title: Hermes Agent images and local cache
description: Understand release synchronization, image pulls, Docker storage locations, inspection, and safe cleanup.
updatedAt: 2026-08-14
keywords:
  - Docker images
  - Hermes Agent
  - image cache
  - Docker Desktop
---

MyBay stores Hermes Agent images in Docker's managed data area, not in the MyBay project directory.

## What each action does

- **Sync releases** refreshes official version metadata. It does not download image layers.
- **Pull image** downloads the selected image into Docker's local cache.
- Deployment may pull an uncached image on demand.

The image registry shows the live state as `Not downloaded`, `Queued`, `Pulling image...`, `Cached locally`, or `Pull failed`.

## Storage locations

- Linux Docker Engine usually uses `/var/lib/docker`; verify with `docker info --format '{{.DockerRootDir}}'`.
- Docker Desktop on Windows usually stores WSL 2 data in `%LOCALAPPDATA%\Docker\wsl\disk\docker_data.vhdx`, although the location can vary.
- Docker Desktop on macOS stores the layers inside its Linux VM disk.

Never edit or delete Docker Desktop's virtual disk directly. It contains Docker-wide images, containers, volumes, and caches—not only Hermes Agent data.

```bash
docker image ls nousresearch/hermes-agent
docker image inspect nousresearch/hermes-agent:<tag>
docker system df
docker image rm nousresearch/hermes-agent:<unused-tag>
```
