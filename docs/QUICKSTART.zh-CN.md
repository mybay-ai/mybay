# 10 分钟部署第一个 Agent

本教程带你从启动 Docker 开始，完成麦贝开源版首次登录、BYOK 模型配置、Agent 部署和本地对话。全部操作仅使用自托管社区开源版和你自己的模型 API Key，不依赖商业版 SaaS 服务。

## 1. 选择访问模式

| 模式 | 适用场景 | 控制台访问方式 |
| --- | --- | --- |
| Desktop | Docker 和浏览器运行在同一台电脑 | `http://localhost:3000` |
| LAN | 同一个可信局域网中的其他设备需要访问 | Docker 宿主机的固定局域网 IPv4 地址 |
| Server | 已准备公网域名并需要 HTTPS | 配置的控制台域名 |

首次使用建议选择 Desktop 模式。Desktop、LAN、Server 三种模式原有的部署前检查都会继续执行。

## 2. 准备安装文件

Windows 用户从 [Releases](https://github.com/mybay-ai/mybay/releases/latest) 下载 `MyBay-Windows-v*.zip` 并解压到普通本地目录。无需预装 Git、Node.js、npm、OpenSSL 或 Docker Desktop。

macOS/Linux 用户先安装 Docker Desktop，或者 Docker Engine 与 Docker Compose v2，然后克隆项目：

```bash
git clone https://github.com/mybay-ai/mybay.git
cd mybay
```

使用 Docker 部署时，宿主机不需要安装 Node.js。

## 3. 启动本地控制台

### Windows 双击启动

```text
Start-MyBay.bat
```

启动器会检查 Windows、虚拟化、WSL、Docker Linux 容器模式、端口和镜像网络，在需要时安装和启动 Docker Desktop、拉取固定版本镜像，并要求用户设置管理员密码。Windows 要求重启时会登记一次性续装任务，重新登录后自动继续。

### macOS 或 Linux

```bash
chmod +x quick-start.sh
./quick-start.sh
```

启动器会检查 Docker、创建或保留 `.env`、生成缺少的本地安全密钥，然后启动 Compose 服务。不要提交或分享 `.env`。

启动完成后打开：

```text
http://localhost:3000
```

页面无法访问时，先检查：

```bash
docker compose ps
docker compose logs --tail=200 mybay-local
```

## 4. 登录控制台

使用 `.env` 中生成或保留的本地管理员账号：

```text
LOCAL_ADMIN_USERNAME
LOCAL_ADMIN_PASSWORD
```

未主动修改时，默认用户名为 `admin`。请妥善保存管理员密码，不要把它放入截图、日志或 Issue。

## 5. 添加 BYOK 模型凭据

登录后打开控制台中的“模型凭据”，添加需要使用的模型服务商凭据。

需要填写：

- 便于识别的凭据名称。
- 模型服务商和 API Key。
- 仅在服务商需要时填写自定义 Base URL。

保存凭据后，在部署流程中执行模型连接测试。宿主机浏览器能访问某个地址，不代表 Agent 容器一定可以访问；自定义端点必须能从 Docker 网络连接。

## 6. 部署第一个 Agent

进入 Agent 部署中心，点击“部署 Agent”。

1. 完成当前访问模式的部署前检查。
2. 填写清晰的实例名称，并为实例设置独立访问凭据。
3. 确认容器、端口和运行参数。
4. 选择模型服务商、模型以及已保存的 BYOK 凭据。
5. 通过模型连接测试后再继续。
6. 第一次验证建议使用 Web 渠道；本地对话正常后再配置外部 IM 渠道。
7. 检查配置摘要，通过原有实例创建入口完成部署。

麦贝会分别判断“容器正在运行”和“聊天已经就绪”。容器已经运行时，聊天 API 仍可能正在初始化，或者模型、渠道配置仍需处理。

## 7. 检查实例就绪状态

发送第一条消息前，确认：

- 实例容器正在运行。
- 物理运行状态与本地数据库一致。
- 聊天状态已经就绪，而不只是容器处于 Running。
- 当前模型凭据已通过连接测试。
- Web 渠道可用于第一次本地对话。

如果实例运行中但聊天仍在初始化，请等待启动检查结束。如果界面提示鉴权、内部路由、模型或渠道错误，应先打开实例诊断，而不是直接反复部署。

## 8. 开始第一次对话

打开实例对话工作区并选中目标实例。生成文件前，点击输入框旁的“快速模式”，切换为“Agent模式”。快速模式只调用模型生成文字，不执行工具或保存文件；Agent 模式才会通过 Hermes 执行任务。

发送一条简短测试消息，例如：

```text
请在当前工作区实际创建并保存 mybay-first-task.html，生成一个不依赖外部资源的 HTML 状态页面，正文包含 MYBAY-FIRST-TASK-OK，并返回文件链接。不要修改其他文件。
```

运行过程中可以查看流式输出、执行步骤、处理时长、生成文件卡片、文件变更和 Result 工作区。选择生成文件即可预览或下载。能否预览取决于文件类型；视频还取决于浏览器支持的编码格式。

任务完成后可以刷新一次页面，确认会话和最终输出能够恢复，并且不会重复拼接已经接收的流式文本。

## 9. 按需切换 LAN 或 Server 模式

可信局域网共享时，绑定 Docker 宿主机实际拥有的一个 IPv4 地址：

```powershell
.\quick-start.ps1 -Mode lan -LanBindIp 192.168.1.20
```

```bash
./quick-start.sh --lan 192.168.1.20
```

不要把 `0.0.0.0` 当作对外展示的局域网地址。

公网服务器需要先配置控制台域名、Agent 通配域名和 80/443 端口，然后执行：

```powershell
.\quick-start.ps1 -Mode server
```

```bash
./quick-start.sh --server
```

切换部署模式会改变生成的 URL、端口绑定和代理标签。切换后需要重新运行部署前检查，并重新部署已有实例。

## 10. 诊断失败环节

修改配置前，先收集本地状态：

```bash
docker compose ps
docker compose logs --tail=200 mybay-local
docker ps -a --filter "name=mybay-agent"
```

常见提示含义：

- `Forbidden`：检查所选凭据、API Key、模型访问权限和服务商 Base URL。
- `CHAT_API_NOT_ENABLED`：实例对话 API 未启用或尚未完成启动。
- `HERMES_API_AUTH_FAILED`：检查实例对话鉴权配置。
- `INTERNAL_ROUTE_AUTH_FAILED` 或 `internal_routing`：使用一致的 `MYBAY_INTERNAL_ROUTING_SECRET` 重建控制台，然后重新部署受影响实例。
- 容器运行但无法聊天：分别检查聊天就绪状态、模型配置、渠道配置和 Agent 日志。
- Docker Hub token 或拉取镜像超时：检查 Docker 的镜像仓库连接、代理和 DNS；网络恢复后重新运行同一个启动命令。
- 3000 端口无法访问：先确认是否已有其他进程或容器监听该端口，再决定是否调整 MyBay 端口。

分享日志时禁止包含 API Key、密码、Cookie、Authorization 请求头、完整 `.env`、真实私网信息、用户文件或内部路由密钥。

## 后续文档

- [本地、局域网与服务器部署](./local-deployment.zh-CN.md)
- [环境变量参考](./env.zh-CN.md)
- [安全指南](./security.zh-CN.md)
- [Docker 镜像缓存与清理](./docker-image-cache.zh-CN.md)
- [自托管运维与恢复（英文）](./self-host-operations.md)
- [常见故障排查](./troubleshooting.zh-CN.md)
