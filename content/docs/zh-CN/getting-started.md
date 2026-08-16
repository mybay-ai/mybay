---
title: 快速开始
description: 在本机启动 麦贝开源版、完成管理员登录，并准备部署第一个 Agent 实例。
updatedAt: 2026-08-14
keywords:
  - 快速开始
  - Docker Compose
  - 本地部署
  - Agent
---

## 使用前准备

首次运行需要安装 Docker Desktop，或安装 Docker Engine 与 Docker Compose v2。确认 Docker daemon 正在运行，并从项目根目录执行启动命令。

> [!NOTE]
> 麦贝开源版是单管理员、本地优先的控制面板。账号、实例配置和加密凭据保存在你自己的主机上。

## 使用快速启动脚本

Windows PowerShell：

```powershell
.\quick-start.ps1
```

Linux 或 macOS：

```bash
chmod +x quick-start.sh
./quick-start.sh
```

脚本会检查 Docker、创建或补全 `.env`、生成安全密钥和管理员密码，然后通过 Docker Compose 启动服务。已经存在的有效配置会被保留。

需要从局域网其他设备访问时，请阅读[本地与服务器部署](/docs/installation/local-deployment)，不要直接把绑定地址改成 `0.0.0.0`。

## 登录本地控制台

默认控制台地址是：

```text
http://localhost:3000
```

管理员用户名来自 `.env` 中的 `LOCAL_ADMIN_USERNAME`，默认是 `admin`。管理员密码由快速启动脚本写入本地 `.env`；不要把该文件提交到 Git 或发送给其他人。

## 添加 BYOK 模型凭据

开源版使用你自己的模型 API Key。登录后打开“凭据管理”，新增模型供应商凭据，再在部署实例时选择它。

详细字段、安全说明和自定义 Base URL 用法请参阅 [BYOK 模型凭据](/docs/models/byok-credentials)。

## 部署第一个 Agent

1. 打开“新建部署”。
2. 选择适合的模板或空白部署。
3. 选择模型供应商、模型和已保存的 BYOK 凭据。
4. 首次验证建议使用 Web 通道。
5. 设置实例访问账号和独立密码。
6. 检查配置摘要并开始部署。

等待实例进入可运行或可对话状态后，再打开实例工作台发送测试消息。

## 验证运行状态

```bash
docker compose ps
docker compose logs --tail=200 mybay-local
```

控制面板正常但实例无法启动时，同时检查 Docker socket 权限、模型凭据、主机资源和 Agent 容器日志。

## 下一步

- 根据访问范围选择[本地、局域网或服务器部署模式](/docs/installation/local-deployment)。
- 配置并轮换 [BYOK 模型凭据](/docs/models/byok-credentials)。
- 在控制台中创建实例并验证 Web 对话。
