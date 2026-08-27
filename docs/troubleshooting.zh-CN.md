# 麦贝开源版常见故障排查

修改配置前，先判断故障发生在哪一层。麦贝会分别报告控制台启动、Agent 容器状态、聊天就绪、模型连通性、消息渠道和文件预览，不能只根据容器是否为 Running 判断全部功能。

## 先保存一份安全的诊断快照

在项目根目录执行：

```bash
docker compose ps
docker compose logs --tail=200 mybay-local
docker ps -a --filter "name=mybay-agent"
```

针对单个 Agent，请打开实例“详情”，记录部署日志、运行日志、就绪报告、错误代码和发生时间，同时注明使用的是 Desktop、LAN 还是 Server 模式。

分享前必须删除 API Key、密码、Cookie、Authorization 请求头、完整 `.env`、内部路由密钥、私网地址、真实域名和用户文件。

## 正确理解实例状态

| 界面状态 | 实际含义 | 下一步检查 |
| --- | --- | --- |
| 部署中 | 控制台仍在创建实例资源 | 部署日志和 Docker 活动 |
| 实例运行中，聊天初始化中 | 容器已运行，但聊天 API 尚未完成启动 | Agent 运行日志和聊天就绪状态 |
| 实例运行中，聊天需要配置 | Docker 正常，但模型、鉴权、路由或渠道仍有问题 | 具体的就绪原因代码 |
| 实例及聊天均已就绪 | 本地 Web 对话链路已经通过 | 发送一条简短测试消息 |
| 部署失败 | 镜像、网络、端口、容器或健康检查失败 | 部署错误代码和技术详情 |
| 聊天鉴权或路由失败 | 容器可能正常，但控制台无法使用聊天 API | 内部 API 和路由凭据 |

Docker 显示绿色 Running 不代表聊天已经可用。可选 Dashboard 的 `9119` 端口可以访问，也不代表 `8642` 聊天 API 已经就绪。

## 3000 端口的控制台无法访问

先检查 Compose 服务：

```bash
docker compose ps
docker compose logs --tail=200 mybay-local
```

Windows 可以只读检查端口占用，不要直接结束进程：

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
docker ps --format "table {{.Names}}\t{{.Ports}}"
```

常见原因包括 Docker 未启动、控制台容器退出、3000 端口被占用、必填安全密钥无效或数据目录无法读取。修改 `PORT` 前应先确认端口属于哪个进程，不要盲目结束其他程序。

Desktop 模式应在 Docker 宿主机打开 `http://localhost:3000`。以 `.localhost` 结尾的实例地址不能直接供其他局域网设备访问。

## Docker Hub token、镜像拉取或 IPv6 超时

`failed to fetch anonymous token`、`auth.docker.io/token`、`dial tcp` 或 `IMAGE_PULL_FAILED` 出现在构建开始前，通常说明 Docker 镜像仓库连接、DNS、代理、防火墙、拉取频率或镜像名称存在问题，不是 MyBay 源码编译错误。

1. 确认 Docker Desktop 或 Docker Engine 能访问 Docker Hub。
2. 检查 Docker 自己的代理和 DNS，而不只是浏览器代理。
3. 确认防火墙或安全软件没有阻止 `registry-1.docker.io` 和 `auth.docker.io`。
4. 如果日志选择了不可达的 IPv6 地址，应按照本地网络策略修复宿主机或 Docker 的 IPv6 路由、DNS 优先级。
5. 确认镜像名称和版本标签真实存在。
6. 网络恢复后重新运行同一个 Quick Start 命令；已有 `.env` 会被保留。

不要因为错误显示在 Dockerfile 第一行，就修改 Dockerfile 的语法声明。

## 模型测试返回 `Forbidden`

`Forbidden` 通常来自模型服务商，而不是部署端口错误。

检查：

- 当前部署选择的是目标保存凭据，而不是旧凭据或空 Key。
- API Key 仍然有效，并具有所选模型的访问权限。
- 模型 ID 与账号、服务商实际支持的名称一致。
- Base URL 属于当前服务商，并包含服务商要求的路径格式。
- 自定义端点可以从 Agent 容器网络访问。
- 服务商的地区、组织、项目或 IP 限制允许当前请求。

使用小请求重新测试。禁止把 API Key 放进日志或截图。如果手动 Key 与保存凭据结果不同，请重新选择凭据，并在保存前确认界面显示的凭据来源正确。

## 容器运行但无法聊天

根据具体原因处理：

### `CHAT_API_NOT_ENABLED`

实例没有启用内部聊天 API，或者聊天 API 尚未完成启动。生成的运行配置需要在 `8642` 端口启用 API Server。只重启可选 Dashboard 无法解决这个问题。

### `HERMES_API_AUTH_FAILED`

控制台已经访问到 Agent API，但内部 API 凭据被拒绝。通过麦贝保存实例配置并重启 Agent，确保两端使用同一份生成值。

### `INTERNAL_ROUTE_AUTH_FAILED` 或 `internal_routing`

控制台与 Agent 使用的内部路由密钥不一致。检查 `MYBAY_INTERNAL_ROUTING_SECRET`，使用一致配置重建控制台，然后重新部署受影响实例。比较配置时不要泄露真实密钥。

### 模型或渠道配置不可用

保留正在运行的容器，只修正对应配置。模型或外部通讯渠道异常不应被当作 Docker 部署失败处理。

## 飞书或 Lark 适配器不可用

日志出现 `requirements not met`、`adapter creation failed` 或 `No adapter available for Feishu`，表示当前 Agent 镜像缺少飞书运行依赖，或者适配器配置尚未闭环。

开源版本选择飞书/Lark 后，会根据 `Dockerfile.feishu` 在本地准备经过验证的飞书兼容镜像。首次构建可能需要几分钟。

检查：

1. 所选 Hermes 版本明确声明支持飞书/Lark。
2. 安装目录中存在 `Dockerfile.feishu`。
3. Docker 可以拉取基础镜像并安装依赖。
4. Docker 宿主机具有足够磁盘空间保存派生镜像。
5. 部署日志明确显示飞书依赖验证成功。
6. App ID、App Secret、服务区域、应用权限、事件订阅、允许用户和允许群聊均与飞书/Lark 应用一致。

修复原因后重新部署，或者保存实例配置并重启容器，使实例使用已验证镜像。不要在运行中的容器里手工安装依赖，因为重新创建容器后这些修改会丢失。

如果飞书已经能够双向收发消息，应逐项阅读诊断结果。未使用的可选 Web Dashboard 或网关路径不应被误判为飞书渠道失败。

## 热更新提示保存失败

模型或 API 设置保存时出现 `"[object Object]" is not valid JSON`，先确认浏览器和服务端运行的是同一份最新构建。重建或重启控制台，浏览器强制刷新，重新打开实例配置，然后仅使用一个保存凭据或一个手动 Key 重试。

最新构建仍然失败时，请保留响应状态、错误代码、时间和脱敏后的服务端日志。诊断时不要同时修改模型、渠道和密码等多组字段。

## HTML 预览白屏或无法操作

先切换“源码”和“页面”视图，判断是渲染失败还是文件本身为空。

检查：

- 当前选择的是实例工作区中的容器生成文件，通常位于 `outputs/<类型>/<项目>/...`，而不是 Agent 推测出的 Windows 宿主机路径。
- HTML 文件不为空，并包含完整文档或有效应用入口。
- 引用的 CSS、JavaScript、图片、字体和媒体文件都存在于同一个生成项目中。
- TypeScript 或 TSX 已经构建成浏览器可以运行的 HTML 和 JavaScript。
- 页面不依赖开发服务器、仅容器可用的 localhost Vite 地址、缺失的 `node_modules`、外部 CDN 或远程 API。

HTML 会在安全沙箱中运行，网络连接、嵌套页面、对象和表单提交会被主动限制。为了稳定预览，应让 Agent 生成自包含的本地构建，并把入口和依赖放在同一个项目目录。

等待 Agent 写完所有依赖后点击“重新加载预览”。如果诊断页列出缺失资源，应补齐资源，而不是降低沙箱安全限制。

## MP4 或 MOV 提示不支持的视频格式

麦贝可以使用字节范围响应传输 `.mp4` 和 `.mov`，但文件后缀不能说明内部视频和音频编码。最终能否播放仍取决于浏览器支持的 Codec。

通常兼容性较好的格式是 MP4 容器、H.264 视频、AAC 音频、`yuv420p` 像素格式和 fast-start 元数据。HEVC/H.265、ProRes、特殊音频编码或部分 MOV 组合可能无法在当前浏览器播放。

本机已经安装 `ffprobe` 时可以检查：

```bash
ffprobe -hide_banner input.mov
```

确认适合转换并且已经安装 `ffmpeg` 时，可以生成兼容版本：

```bash
ffmpeg -i input.mov -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart output.mp4
```

同时确认文件已经写完且大小不为零，然后重新加载预览。这不会改变麦贝已有的上传大小、数量、类型或校验规则。

## 中文文件名显示乱码

使用当前最新构建刷新页面并重新上传一次，确认原始 UTF-8 文件名在附件卡片、生成文件卡片、下载名称和工作区文件列表中保持一致。早期版本已经保存的历史记录可能仍保留当时的显示名称。

不要根据乱码字符猜测并重命名原文件。如果问题仍能复现，请保留原文件，记录一条脱敏后的示例文件名、浏览器版本和请求时间。

## 刷新会话后输出重复或发生变化

等待运行进入终态后刷新一次。服务端快照恢复时，不应再次拼接已经处理的流式事件、其他 `runId` 的事件或上一轮仍处于 pending 的助手消息。

刷新后内容变化时，请记录会话 ID、run ID、request ID、事件序号、终态和时间，但不要提交可能含敏感信息的消息正文。同时检查 Agent 容器是否在运行过程中重启。

## 提交 Issue 前

请提供：

- MyBay 版本或提交版本。
- Desktop、LAN 或 Server 模式。
- 操作系统和 Docker 版本。
- 涉及界面或预览时的浏览器及版本。
- 准确的错误代码和发生时间。
- 脱敏后的控制台与 Agent 日志片段。
- 新实例或新会话能否复现。

禁止包含任何凭据、密钥、私有基础设施信息和用户数据。

相关文档：

- [部署第一个 Agent](./QUICKSTART.zh-CN.md)
- [本地、局域网与服务器部署](./local-deployment.zh-CN.md)
- [环境变量](./env.zh-CN.md)
- [安全指南](./security.zh-CN.md)
