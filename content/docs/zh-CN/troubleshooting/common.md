---
title: 常见故障排查
description: 根据错误现象检查启动脚本、容器状态、实例地址、内部路由、对话 API 和异步任务。
updatedAt: 2026-08-14
keywords:
  - 故障排查
  - BEGIN_TURN_FAILED
  - UPSTREAM_RUN_NOT_FOUND
  - chat readiness
  - internal_routing
---

## 启动脚本没有执行权限

Linux 或 macOS 出现 `quick-start.sh: Permission denied` 时：

```bash
chmod +x quick-start.sh
./quick-start.sh
```

也可以执行 `bash quick-start.sh`。如果仍然失败，确认当前目录是项目根目录，并检查 Docker daemon 是否正在运行。

## 控制面板容器退出

先收集状态和最近日志：

```bash
docker compose ps
docker compose logs --tail=200 mybay-local
```

常见原因包括 `.env` 必填项缺失、端口被占用、数据目录不可写、Docker Socket 无法访问或安全密钥格式错误。修复后使用原来的部署模式重建服务。

## 实例地址无法访问

`agent-xxx.localhost` 只适用于 Docker 宿主机。其他局域网设备必须使用 LAN 模式；公网服务器必须使用带真实域名和 HTTPS 的 server 模式。

切换模式后应重新部署旧实例。只重启容器不会替换已经生成的 URL、端口绑定和 Traefik 标签。

## internal_routing 检查失败

`Routing secret missing` 或 `internal_routing` 失败表示 `MYBAY_INTERNAL_ROUTING_SECRET` 缺失、格式错误或两端不一致。

检查 `.env` 后重建控制面板、重新部署受影响实例，再运行 Preflight 和 chat readiness。不要把真实密钥复制到日志或问题报告。

## CHAT_API_NOT_ENABLED

该错误表示实例没有启用内部对话 API。检查生成配置是否包含：

```text
API_SERVER_ENABLED=true
API_SERVER_PORT=8642
```

更新后重新部署实例。Dashboard 的 `9119` 端口正常并不能证明对话 API 已启用。

## BEGIN_TURN_FAILED

该错误表示控制面板未能初始化对话回合。检查管理员会话、chat readiness、`8642` 监听、BYOK 凭据、数据目录写权限，以及同一时间段的控制面板和 Agent 日志。

修复后新建一条测试消息，不要反复提交相同的大型请求。

## UPSTREAM_RUN_NOT_FOUND

该错误表示控制面板跟踪的异步任务在 Agent 侧已经找不到。实例重启、上游任务过期或状态不同步时可能出现。

部分已保存输出仍可能保留。刷新会话并查看任务详情；无法恢复时重新提交请求。持续出现时，检查实例是否频繁重启，并核对两端的时间、网络和运行状态。

## 文件或容量问题

文件卡片不可用时，确认文件仍位于当前实例工作区，并且没有触发路径、类型或敏感内容限制。磁盘不足时清理不再需要的日志、缓存和生成文件，但先备份重要交付物。

详情请参阅[文件、预览与本地存储](/docs/workspace/files)。

## 提交问题前

保留错误代码、发生时间、部署模式、容器状态和已脱敏日志。删除 API Key、密码、Authorization 请求头、Cookie、完整 `.env`、真实域名、私网地址、用户文件和内部路由密钥。