# 可选模板与自动流扩展

麦贝开源版 默认只提供标准 Agent 实例部署与生命周期管理。模板中心、Blueprint、Webhook 自动流和模板定时调度作为可选扩展保留在源码中，但默认不加载、不展示也不执行。

默认配置：

```env
TEMPLATE_CENTER_ENABLED=false
SCHEDULER_RUNNER_ENABLED=false
```

关闭状态下：

- 导航栏不显示模板中心；
- 实例部署直接进入标准 Agent 部署向导；
- URL 中的 `template_id`、`workflow_id` 和 `blueprint_id` 会被忽略；
- 后端拒绝模板或 Blueprint 部署请求；
- 模板 API 与 Webhook API 不开放；
- 模板种子数据不初始化，模板定时调度器不启动；
- 已有实例、SQLite 数据和模板源码不会被删除。

以后需要重新启用时，将 `.env` 中两个值都改为 `true`，然后重建控制面板：

```powershell
docker compose up -d --build
```

模板功能仍属于可选扩展，启用后应重新执行模板、Webhook、文件输入和定时任务的端到端验收。
