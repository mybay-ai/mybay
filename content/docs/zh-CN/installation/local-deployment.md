---
title: 本地与服务器部署
description: 选择本机桌面、局域网共享或公网服务器模式，并正确配置访问地址与端口。
updatedAt: 2026-08-14
keywords:
  - 本地部署
  - 局域网
  - Traefik
  - HTTPS
---

## 环境要求

- Docker Desktop，或 Docker Engine 24+
- Docker Compose v2
- 至少 2 核 CPU、4 GB 内存和 10 GB 可用磁盘空间
- 控制面板容器能够访问 `/var/run/docker.sock`

> [!WARNING]
> Docker socket 具有较高主机权限。只在可信主机运行控制面板，并保护管理员账号和 `.env`。

## 本机桌面模式

Windows：

```powershell
.\quick-start.ps1
```

Linux 或 macOS：

```bash
./quick-start.sh
```

控制台和 Agent 动态端口仅绑定 `127.0.0.1`。默认打开 `http://localhost:3000`，实例的 `.localhost` 地址只能从 Docker 主机访问。

## 局域网共享模式

Linux 或 macOS：

```bash
./quick-start.sh --lan 192.168.1.20
```

Windows：

```powershell
.\quick-start.ps1 -Mode lan -LanBindIp 192.168.1.20
```

填写 Docker 主机真实的局域网 IP，不要填写 `0.0.0.0`。根据需要允许控制台端口以及 `.env` 中 `MY_BAY_PORT_START` 到 `MY_BAY_PORT_END` 的动态端口范围。

## 公网服务器模式

准备控制台域名、Agent 根域名、证书邮箱，并确保公网 80/443 端口可用。

```bash
./quick-start.sh --server
```

```powershell
.\quick-start.ps1 -Mode server
```

该模式通过 `docker-compose.server.yml` 启动 Traefik，自动申请 HTTPS 证书，并避免直接向公网暴露 Agent 动态端口。

## 手动使用 Docker Compose

```bash
cp .env.example .env
# 修改管理员密码，并生成 JWT_SECRET、ENCRYPTION_KEY、MYBAY_INTERNAL_ROUTING_SECRET
docker compose up -d --build
```

服务器模式：

```bash
docker compose -f docker-compose.yml -f docker-compose.server.yml up -d --build
```

首次部署建议使用快速启动脚本，避免遗漏必需的密钥、域名和代理变量。

## 切换部署模式

1. 使用目标模式重新运行快速启动脚本。
2. 重建控制面板容器。
3. 对已有 Agent 实例执行重新部署。
4. 验证控制台 URL、实例访问地址和防火墙规则。

部署模式会改变端口绑定、实例地址和 Traefik 标签，仅重启旧容器不足以完成切换。

## 备份与升级

`.env` 保存安全密钥，`data/` 保存控制面板数据库、实例配置和工作目录。升级前停止写入并备份两者。

```bash
docker compose stop
docker compose up -d --build
```

不要在没有凭据迁移方案时更换 `ENCRYPTION_KEY`，否则已有加密 API Key 可能无法解密。

## 诊断命令

```bash
docker compose ps
docker compose logs --tail=200 mybay-local
docker ps -a --filter "name=mybay-agent"
```

服务器模式还可以检查：

```bash
docker compose -f docker-compose.yml -f docker-compose.server.yml logs --tail=200 traefik
```
