---
title: Hermes Agent 镜像与本地缓存
description: 了解版本同步、镜像拉取、Docker 存储位置、查看方式与安全清理方法。
updatedAt: 2026-08-14
keywords:
  - Docker 镜像
  - Hermes Agent
  - 镜像缓存
  - Docker Desktop
---

麦贝把 Hermes Agent 镜像存放在 Docker 管理的数据区中，而不是 麦贝项目目录中。

## 各操作的作用

- **同步版本**只刷新官方版本元数据，不下载镜像层。
- **拉取镜像**会把所选镜像下载到本机 Docker 缓存。
- 部署也可能按需拉取尚未缓存的镜像。

镜像仓库会实时显示“未下载”“等待拉取”“正在拉取镜像…”“已缓存到本机”或“拉取失败”。

## 存放位置

- Linux Docker Engine 通常使用 `/var/lib/docker`，可用 `docker info --format '{{.DockerRootDir}}'` 确认。
- Windows Docker Desktop 的 WSL 2 数据通常位于 `%LOCALAPPDATA%\Docker\wsl\disk\docker_data.vhdx`，实际位置可能因设置而变化。
- macOS Docker Desktop 会把镜像层存放在其 Linux 虚拟机磁盘内。

不要直接编辑或删除 Docker Desktop 的虚拟磁盘。它包含 Docker 全局的镜像、容器、数据卷和缓存，并不只属于 Hermes Agent。

```bash
docker image ls nousresearch/hermes-agent
docker image inspect nousresearch/hermes-agent:<tag>
docker system df
docker image rm nousresearch/hermes-agent:<unused-tag>
```
