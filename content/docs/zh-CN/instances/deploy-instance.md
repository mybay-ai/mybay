---
title: 部署 Agent 实例
description: 从部署前检查到模型、渠道、资源配置和运行验收，完成一个开源版 Agent 实例的部署。
updatedAt: 2026-08-14
keywords:
  - 实例部署
  - Preflight
  - Web 渠道
  - 运行检查
---

## 部署前准备

部署实例前，先完成[快速开始](/docs/getting-started)，并根据实际访问范围配置[本地、局域网或服务器模式](/docs/installation/local-deployment)。

在部署前检查中确认 Docker、数据目录、端口池和 Docker 网络可用，同时确认 `ENCRYPTION_KEY` 与 `MYBAY_INTERNAL_ROUTING_SECRET` 已配置。server 模式还需要正确的域名、Traefik 和 HTTPS 前置条件。

> [!WARNING]
> `internal_routing` 失败通常表示内部路由密钥缺失，或控制面板与实例配置不一致。修复 `.env` 后需要重建控制面板，并重新部署受影响实例。

## 选择部署起点

可以从适合任务的模板开始，也可以选择空白部署。模板只提供初始配置；部署前仍应逐项确认镜像、模型、渠道、资源和访问凭据。填写便于识别的实例名称，不要在名称、描述或普通环境变量中写入 API Key。

## 配置模型和凭据

选择模型供应商、模型以及已保存的 BYOK 凭据。凭据由控制面板解密后写入实例配置。还没有可用凭据时，请先阅读 [BYOK 模型凭据](/docs/models/byok-credentials)。

自定义兼容服务的 Base URL 必须能从 Agent 容器网络访问。浏览器可以访问某个地址，并不代表容器也能访问。

## 选择通信渠道

首次验证建议启用 Web 渠道：

- 内部对话 API 默认使用端口 `8642`。
- 可选 Dashboard 默认使用端口 `9119`。
- `9119` 可访问不代表 `8642` 已经可以对话。
- 外部渠道需要各自的凭据和回调配置。

如果只需要控制台对话，不要为了测试同时启用所有外部渠道。

## 设置资源和访问

CPU、内存、磁盘和实例数量限制用于保护本地主机，应根据真实资源设置。为实例设置独立访问账号和强密码。公网模式只通过 Traefik 暴露需要的入口，不要公开 Docker Socket 或内部服务端口。

## 部署并验收

确认任务没有停留在失败状态、Agent 容器进入 Running、Web 实例 chat readiness 可用、可选 Dashboard 可访问，并在控制台发送一条测试消息。实例 URL、文件预览和下载也应符合部署模式。

```bash
docker compose ps
docker compose logs --tail=200 mybay-local
docker ps -a --filter "name=mybay-agent"
```

容器 Running 只是基础条件。对话仍不可用时，请继续查看[常见故障排查](/docs/troubleshooting/common)。