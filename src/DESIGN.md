# 麦贝开源版架构设计

## 1. 产品边界

麦贝开源版是单管理员、本地优先的开源 Agent 控制面板：

- 不提供公开注册、邮箱验证和多租户 RBAC
- 所有平台数据均保存在本机，不依赖商业云主节点、托管计费或平台模型网关
- 使用本地 JSON 状态存储和本地 `data/` 目录
- 通过 Docker Engine 创建和管理一个或多个独立 Agent Runtime 容器

## 2. 主要组件

### Web 前端

React、TypeScript 和 Vite 构建的单页应用，提供部署向导、实例管理、日志与诊断、文件管理和对话工作台。界面文案通过 i18n 资源提供中英文版本。

### Control Plane

Node.js 与 Express 服务负责：

- 本地管理员认证与会话校验
- 本地状态读写和敏感凭据加密
- Runtime 规格解析与部署前校验
- Agent 容器生命周期、日志、指标和文件代理
- 将对话请求安全转发到 Agent 8642 API
- 根据部署模式生成访问 URL、端口绑定和网关配置

### Local Store

平台状态保存在 `data/mybay.sqlite`。实例工作区、上传文件和运行数据位于 `data/`，该目录必须持久化并在升级前完整备份。

### Agent Runtime

每个实例由独立 Agent 容器承载。运行能力通过 `mybay.runtime.yaml` 声明，并使用 JSON Schema 校验。Hermes 常用端口：

- `8642`：Agent 对话 API
- `9119`：可选的 Hermes Web Dashboard

## 3. 网络模式

### desktop

控制台和 Agent 动态端口只绑定 `127.0.0.1`。实例可以显示 `.localhost` URL，仅 Docker 宿主机可访问。

### lan

绑定宿主机一个明确的局域网 IPv4。不会自动监听所有网卡。访问范围由宿主机路由和防火墙控制。

### server

控制面板与 Agent 加入 `traefik_proxy` 网络。Traefik 根据 Docker 标签和真实子域名转发 HTTPS 流量；仅 80/443 对公网开放，Agent 动态宿主端口保持私有。

## 4. 内部鉴权

浏览器先通过本地管理员会话访问 Control Plane。Control Plane 再向 Agent 内部 API 发起请求，并使用实例 API Key 与内部路由密钥保护链路。

`MYBAY_INTERNAL_ROUTING_SECRET` 用于控制面与实例路由端点之间的鉴权。缺失或不一致时，Preflight 会报告 `internal_routing` 失败。

## 5. 对话运行模型

对话工作台使用实例 ID、会话 ID、generation 和 runId 标识当前运行：

1. 用户提交消息并创建本地 run。
2. Control Plane 初始化 Agent turn 并消费流式事件或轮询结果。
3. UI 只接受仍属于当前实例、会话和 generation 的事件。
4. 任务结束时收敛未结束步骤、清理 loading 并刷新历史。
5. 部分输出、步骤耗时、文件结果和通知按 run 持久化或恢复。

该模型避免用户切换实例或会话后，旧任务继续污染当前页面。

## 6. 文件安全

所有实例文件操作必须同时满足：

- 当前本地管理员会话有效
- 文件路径属于目标实例工作区
- 路径规范化后不存在目录穿越
- 文件类型适合预览或下载
- 未触发敏感文件与 Secret 泄漏保护

禁止导出环境文件、私钥、凭据文件、Secret 文本和危险压缩包。

## 7. 资源保护

`MAX_INSTANCE_COUNT`、`DEFAULT_INSTANCE_MEMORY`、`DEFAULT_INSTANCE_CPUS` 和 `DEFAULT_INSTANCE_DISK_MB` 是本地宿主机保护默认值，不属于计费配额。修改默认值不会自动重建已有实例。

## 8. 验证要求

提交架构或 Runtime 变更前运行：

```bash
npm run typecheck
npm test
npm run test:schema
npm run check:mojibake
npm run build
```

涉及部署网络时还应验证 desktop、lan 和 server 三种配置，以及模式切换后已有实例重新部署。
