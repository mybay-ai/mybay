# 麦贝开源版（MyBay Open Source）

语言：[English](./README.md) | [简体中文](./README.zh-CN.md)

一个用于通过 Docker 部署和管理 AI Agent Runtime 的本地自托管控制平台。

麦贝开源版是单管理员、本地优先的 AI Agent（如 Hermes Agent）容器管理与交互平台。

该版本完全独立运行，无任何托管云服务、云端主节点、注册流程或付费套餐依赖。

MyBay Open Source 是可自行部署的社区开源版本；[mybay.ai](https://mybay.ai) 提供的托管服务属于独立的商业服务，安装和运行本仓库不需要注册或依赖该服务。

> **发布状态：Early Preview（`v0.1.0-preview`）。** 在 0.x 阶段，公共接口、Runtime Adapter、部署细节与升级行为仍可能调整。

## 与 Hermes Agent 的项目关系

MyBay 是独立维护的开源项目，并非 Nous Research 官方产品，也不代表 Nous Research 对本项目的赞助、认可或维护。Hermes Agent 是由 Nous Research 维护、采用 MIT License 发布的独立项目。MyBay 仅通过其公开的 Runtime 与容器接口进行兼容集成。

许可证与署名详情见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 核心特性

- **单管理员控制台**：专为本地与私有服务器打造的 Agent 容器控制面板。
- **本机 SQLite**：平台状态通过事务持久化在 `data/mybay.sqlite`。
- **BYOK 自备密钥**：灵活配置 OpenAI、Anthropic、DeepSeek、Ollama 等 OpenAI 兼容大模型供应商。
- **Agent 全生命周期管理**：支持 Docker 容器的一键部署、重启、热更新、状态检测和实时日志查看。
- **交互式对话工作台**：完整的 Agent 对话界面，支持运行生命周期隔离、可折叠工具步骤、任务与步骤耗时、Markdown、生成文件预览、安全下载和后台完成通知。
- **Docker Compose 一键部署**：开箱即用的 `docker-compose.yml`，一键启动完整服务。

---

## 快速开始与部署指引

### 方式一：本机桌面一键部署

前置要求：Docker Engine 或 Docker Desktop，以及 Docker Compose。宿主机不需要安装 Node.js。macOS/Linux 启动器还会使用 `openssl` 和标准 POSIX shell 工具；Windows 启动器直接使用系统内置的 .NET 密码学 API，不要求安装 OpenSSL。

适用于浏览器和 Docker 运行在同一台电脑上的场景：

**Windows PowerShell 5.1 或 PowerShell 7：**

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\quick-start.ps1
```

**macOS 或 Linux：**

```bash
chmod +x quick-start.sh
./quick-start.sh
```

控制台和 Agent 端口默认只绑定 `127.0.0.1`。
如果需要让同一局域网内的其他设备访问，请绑定宿主机一个明确的网卡地址：

```bash
./quick-start.sh --lan 192.168.1.20
```

```powershell
.\quick-start.ps1 -Mode lan -LanBindIp 192.168.1.20
```

### 方式二：公网服务器 + 自动 HTTPS

请先将控制台域名和 Agent 通配域名解析到服务器，然后运行：

```powershell
.\quick-start.ps1 -Mode server
```

或在 macOS/Linux 上运行：

```bash
chmod +x quick-start.sh
./quick-start.sh --server
```

脚本会引导填写控制台域名、Agent 根域名和证书邮箱，自动启动 Traefik、申请 HTTPS 证书，并且只向公网开放 80/443。例如配置 `console.example.com` 和 `*.agents.example.com` 两条 DNS 记录。

> 两个 Quick Start 启动器都会自动创建 `.env`、生成高强度安全密钥和管理员密码，并共享同一套 Docker Compose 与环境变量契约；再次运行时会保留已有服务器模式配置。

---

### 方式三：标准 Docker Compose 手动部署

1. **克隆项目并复制环境变量文件：**
   ```bash
   git clone https://github.com/mybay-ai/mybay.git
   cd mybay
   cp .env.example .env
   ```

2. **生成并配置生产必填安全值：**
   ```bash
   # ENCRYPTION_KEY 与内部路由密钥均为 64 位十六进制字符串
   openssl rand -hex 32
   openssl rand -hex 32

   # JWT_SECRET 至少包含 32 字节
   openssl rand -base64 48
   ```
   将生成值分别写入 `ENCRYPTION_KEY`、`MYBAY_INTERNAL_ROUTING_SECRET` 与 `JWT_SECRET`，并设置 `LOCAL_ADMIN_USERNAME` 和高强度 `LOCAL_ADMIN_PASSWORD`。这些变量与 `docker-compose.yml` 的必填约束完全一致。

3. **使用 Docker Compose 启动：**
   ```bash
   docker compose up -d
   ```
   *（若使用旧版 Docker，可执行 `docker-compose up -d`）*

4. **访问控制台：**
   在浏览器中打开 `http://localhost:3000`，使用配置的管理员账号登录。

---

### 方式四：Node.js 本地开发与运行

#### 前置要求
- Node.js 22.13.0 或更高版本及 npm
- 已安装并启动 Docker Engine / Docker Desktop（用于管理 Agent 容器）

1. **安装依赖：**
   ```bash
   npm install
   ```

2. **配置环境变量：**
   ```bash
   cp .env.example .env
   ```
   编辑 `.env` 文件，填入 `JWT_SECRET`、`ENCRYPTION_KEY` 以及管理员账号密码。

3. **启动开发服务：**
   ```bash
   npm run dev
   ```

4. **生产构建与启动：**
   ```bash
   npm run build
   NODE_ENV=production npm start
   ```

访问 [http://localhost:3000](http://localhost:3000) 进入控制面板。

`VITE_PUBLIC_APP_URL` 与 `VITE_MYBAY_PLATFORM_ORIGIN` 属于构建时变量。Docker Compose 会将其作为 Docker build args 传入 Vite；修改后必须重新构建镜像。服务端运行时变量仍从 `.env` 读取，Compose 则始终以 `NODE_ENV=production` 运行控制面板。

---

## 关键环境变量说明

| 环境变量 | 作用说明 | 默认值 |
| --- | --- | --- |
| `PORT` | Web 控制台监听端口 | `3000` |
| `NODE_ENV` | 服务运行模式；Compose 固定为 production | `.env.example` 中为 `development` |
| `LOCAL_ADMIN_USERNAME` | Web 控制台登录用户名 | `admin` |
| `LOCAL_ADMIN_PASSWORD` | Web 控制台登录密码 | `change-me-now` |
| `JWT_SECRET` | JWT 会话 Token 签名密钥（至少 32 字节） | *在 .env 中替换* |
| `ENCRYPTION_KEY` | AES-256 敏感凭据加密密钥（64 位 hex 字符串） | *必填* |
| `MYBAY_INTERNAL_ROUTING_SECRET` | 实例内部路由认证密钥（64 位 hex 字符串） | *必填* |
| `VITE_PUBLIC_APP_URL` | Docker/Vite 构建时写入前端的公网地址 | `http://localhost:3000` |
| `VITE_MYBAY_PLATFORM_ORIGIN` | 构建时传入前端的平台 Origin | `http://localhost:3000` |
| `MY_BAY_IMAGE` | Hermes Agent 默认 Docker 镜像 | `nousresearch/hermes-agent` |
| `MYBAY_SQLITE_PATH` | 本机 SQLite 数据库文件路径 | `data/mybay.sqlite` |

---

## 本地数据存储说明

应用的所有运行状态、容器配置、对话历史、上传文件和日志均安全地持久化存储在本地 `data/` 目录中：

```txt
data/
  mybay.sqlite        # 本机 SQLite 数据库（实例、凭据、任务和设置）
  instances/          # Agent 实例挂载目录与运行时数据
  uploads/            # 用户上传的文件和资源
  logs/               # 系统与部署日志
```

> **注意：** 请勿将 `data/` 目录提交至 Git 代码仓库。

---

## 安全注意事项

- 本开源版本专为可信本地开发环境和私有服务器设计。
- 公网服务器请使用 `./quick-start.sh --server`；脚本会配置 Traefik 和 HTTPS，并避免将 Agent 动态端口直接暴露到公网。
- Control Plane 为管理实例生命周期需要访问 `/var/run/docker.sock`。该 Socket 可对 Docker daemon 执行高权限操作，实际可能等同于宿主机级管理能力。
- 应将 MyBay 管理员权限视为高权限宿主机管理权限；不要在没有防护的情况下把控制面直接暴露到公网。
- 公网部署必须使用强管理员密码、安全反向代理和 HTTPS，并推荐配合 VPN、私有网络或 IP allowlist。
- 严禁将包含真实 API Key 或敏感密钥的 `.env` 及 `data/` 提交到公开仓库。

---

## Runtime 支持状态

- **Hermes Agent：** 当前 Preview 创建与生命周期链路支持的 Runtime。
- **Pi Agent：** 实验预览 / 即将推出。UI 无法提交 Pi 部署，API 对 `runtime_type=pi` 明确返回 `PI_RUNTIME_PREVIEW_ONLY`。仓库中的 Adapter 与规范文件仅用于集成预览，不代表生产支持。

完整 Pi 后端部署链路计划在后续版本提供。

---
## Agent 运行态接入规范 (`mybay.runtime.yaml`)

MyBay 提供可扩展的 **Agent Runtime Specification（运行态接入规范）**，用于未来接入更多开源 Agent。当前支持的 Runtime 为 Hermes Agent；Pi 规范仅是实验参考：

- **JSON Schema 校验规范**：`/public/schemas/mybay.runtime.schema.json`
- **运行态规格声明示例**：
  - Hermes Agent：`/public/specs/mybay.runtime.yaml`
  - Pi Agent 实验参考：`/public/specs/pi.runtime.yaml`

通过定义 `mybay.runtime.yaml` 规格文件，开发者可以标准化声明 Agent 容器端口、健康检查 Endpoint、挂载卷路径及支持的通讯渠道（飞书、Telegram、Discord、Slack、微信等）。

---

## 更多文档

- `docs/local-deployment.zh-CN.md`：本地部署详细流程
- `docs/env.zh-CN.md`：环境变量详细说明
- `docs/docker-image-cache.zh-CN.md`：Hermes Agent 镜像拉取、存储位置与清理说明
- `docs/security.zh-CN.md`：安全架构与注意事项

英文文档：
- `docs/local-deployment.md`
- `docs/env.md`
- `docs/docker-image-cache.md`
- `docs/security.md`

---

## 贡献指南

欢迎提交适合麦贝开源版定位的改进与 Issue！提交 PR 前请阅读 `CONTRIBUTING.md`。

## 许可证

本仓库采用 `AGPL-3.0-only` 开源许可证。如需商业授权，请单独联系项目所有者。第三方名称、商标及集成 Logo 的相关说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
