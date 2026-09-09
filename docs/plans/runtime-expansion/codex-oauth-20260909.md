# Codex OAuth 接入记录

日期：2026-09-09

- Codex 模型提供商列表新增已有的 OpenAI Codex (ChatGPT OAuth)，复用本地设备码授权和加密凭据管理。
- 创建接口按当前用户读取已保存凭据，检查凭据类型和完整账号令牌，再转换为 Codex 原生 ChatGPT auth.json；不将 OAuth 当成第三方 API Key。
- 保留 API Key 与账号文件导入方式，修复提交清理过程遗漏 codexAuthMode 的问题。
- OAuth 等待期间禁止切换 Runtime 或认证入口。
- 定向测试初轮 5 文件 29 项通过；新增请求序列化检查及字段修复后，请求与清理测试 2 文件 16 项通过。ESLint 和 i18n 检查通过。
- 最终 Docker 镜像 mybay/local:codex-oauth-20260909 构建通过，并更新 localhost:3000。
- 浏览器确认提供商选项可见、可选择；选择后显示连接 OAuth 账号按钮，隐藏 API Key、Base URL 和普通 API 测试。
- 真实 OpenAI 登录、令牌刷新、部署后真实对话：NOT_RUN，需用户完成账号授权后验收。

官方设备码登录说明：https://learn.chatgpt.com/docs/auth
