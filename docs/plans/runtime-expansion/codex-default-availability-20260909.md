# Codex 默认开放 / Default availability

2026-09-09：按用户要求，开源版 Codex Runtime 创建默认开放。移除目录和创建后端的 `MYBAY_ENABLE_CODEX_RUNTIME` 门禁，以及示例环境中的关闭配置。旧部署即使保留这个变量也不会再影响 Codex 创建。

用户在 Quick Deploy 选择 Codex，并导入自己的有效 Codex / ChatGPT 账号文件即可进入部署流程。账号校验、功能范围、隔离机制和 Experimental 认证等级保持现有行为。Pi 的启用规则和暂停中的 Claude 候选不属于本次变更。

本地验证：目录、创建边界和快速部署校验 15 项测试通过；生产构建通过。真实隔离控制服务在未设置启用变量时返回 Codex `deploymentSupported: true`，无账号的创建请求进入账号校验并返回 `CODEX_ACCOUNT_AUTH_INVALID`。本轮没有重复创建 Runtime；完整创建和实际执行证据沿用 P2 与恢复验收报告。

新增修改的 ESLint 与 TypeScript 检查通过。本次未重跑全量发布门禁；前轮记录的一次门禁超时及单独复跑结果仍按原报告保留。

这是本地分支变更，没有推送 GitHub，也没有替换正在运行的 4348 服务。验证使用的 4360 控制服务已停止，数据保留。历史 P2 报告中的 opt-in 描述记录当时状态，由本说明更新。
