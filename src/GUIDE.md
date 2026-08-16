# 麦贝开源版使用与运维指南

本文档面向麦贝开源版。麦贝开源版 是单管理员、自托管的 Agent 容器控制面板，不依赖公开注册、云端主节点、托管计费或外部数据库。

## 1. 启动与登录

根据访问范围选择一种模式：

```bash
./quick-start.sh                         # 本机桌面
./quick-start.sh --lan 192.168.1.20      # 可信局域网
./quick-start.sh --server                # 公网服务器、Traefik、HTTPS
```

首次脚本会生成管理员密码和安全密钥。桌面模式默认访问 `http://localhost:3000`。公网服务器需要真实控制台域名、Agent 通配域名以及开放 80/443。

## 2. 创建 Agent 实例

进入“新建实例”后依次完成：

1. **Preflight**：检查 Docker Socket、存储、网络、内部路由鉴权和部署模式。
2. **基础信息**：填写实例名称和访问标识。
3. **容器配置**：选择 Agent 镜像、版本和 Dashboard 开关。
4. **模型配置**：选择供应商和模型，并填写自己的 API Key。
5. **渠道与技能**：选择 Web、飞书、Telegram 等渠道及需要的技能。
6. **资源配置**：按宿主机容量设置 CPU、内存和磁盘保护值。
7. **部署与验收**：等待容器、8642 对话 API 和可选的 9119 Dashboard 就绪。

Web 渠道依赖 8642。9119 仅负责 Hermes Web Dashboard，9119 可访问不代表对话 API 一定正常。

## 3. 三种实例访问方式

- **desktop**：控制台和实例端口绑定 `127.0.0.1`；`.localhost` 地址仅本机可用。
- **lan**：控制台和实例端口绑定一个明确的局域网 IPv4；同网设备通过该 IP 访问。
- **server**：Traefik 通过真实域名和 HTTPS 对外提供服务；动态 Agent 端口不直接暴露到公网。

切换模式后，应重新部署已有实例以更新端口绑定、内部 URL 和网关标签。

## 4. 对话工作台

对话工作台支持：

- 实例、会话、generation 和 runId 生命周期隔离
- 任务与步骤耗时、可折叠工具过程卡片
- 部分输出恢复和终态步骤自动收敛
- Markdown、代码块、表格和链接
- Agent 生成文件识别、点击预览和安全下载
- 页面后台任务完成通知
- 常见离线、超时、路由和初始化错误的人类可读提示

浏览器只访问 MyBay 控制面板，由控制面板在 Docker 内网代理到 Agent 8642，不会把 Agent API Key 下发到浏览器。

## 5. 实例运维

实例详情页可以执行启动、停止、重启、重新部署、查看日志、查看资源状态和浏览实例文件。

修改以下配置后通常需要重新部署实例：

- 部署模式、端口绑定或域名
- Agent 镜像和版本
- 模型凭据或 Agent 环境变量
- Dashboard、渠道和技能
- CPU、内存等容器资源限制

容器显示 `running` 只说明主进程仍存在，应结合部署诊断和 8642/9119 就绪状态判断实际可用性。

## 6. 常见问题

### quick-start.sh: Permission denied

```bash
chmod +x quick-start.sh
./quick-start.sh
# 或
bash quick-start.sh
```

### Routing secret missing

确认 `.env` 中存在有效的 `MYBAY_INTERNAL_ROUTING_SECRET`，重建控制面板并重新部署实例。

### agent-xxx.localhost 无法在其他设备访问

这是 desktop 模式的预期行为。局域网使用 `--lan`，公网服务器使用 `--server`，然后重新部署实例。

### BEGIN_TURN_FAILED

检查实例 chat-readiness、8642 监听、`API_SERVER_ENABLED=true`、内部路由密钥和模型凭据。随后查看控制面板及 Agent 容器日志。

## 7. 数据与安全

- 状态、对话、上传和实例工作区位于 `data/`。
- 升级前备份整个 `data/` 和受保护的 `.env`。
- 不要公开模型 API Key、JWT、加密密钥或内部路由密钥。
- Docker Socket 权限很高，只允许可信控制面板访问。
- 文件导出会阻止 `.env`、私钥、Secret 文本和危险压缩包。
