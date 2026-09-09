# Codex shared model connection / 共用模型接入

本轮复用 providerRegistry、已保存凭据解密、API Key 加密、快速部署模型表单和 test-llm 接口，为原生 Codex 增加 API 模式；保留已有 ChatGPT 账号模式。没有实现 Chat Completions 到 Responses 的协议转换网关。

## 行为

- 选择 Codex 后可使用账号文件，或切换 API 模式，选择已保存凭据/自己的 API。API 模式不要求 auth.json。
- 提供商从统一目录筛选：启用、API Key 认证且声明支持 Responses，以及自定义兼容端点。目前提供 OpenAI、xAI API 和 Custom；不是另建提供商列表，也不表示三者均已真实认证。
- 原生 config.toml 使用 mybay_api provider、Responses 协议及环境变量密钥；禁止混合账号和 API 凭据。切回账号模式清除托管 API 配置，并不生成 API 密钥环境变量。
- API 模式部署前通过现有模型测试接口检查 Responses 结果格式。连接成功只表示基础接口可用，不证明工具与流式完整兼容。内网地址继续受现有出站安全策略约束。
- Runtime 镜像增加 bridge 版本校验，防止复用只支持账号认证的旧镜像。正在运行的 Agent 容器不因更新镜像而重启。

## 验证

- 相关 Vitest 75 项通过，连接探测路由另外 2 项通过，bridge Node 测试 9 项通过。
- ESLint、TypeScript、双语键检查通过；控制与 Runtime 镜像使用实际 Docker 构建。
- 完整门禁中的 Vitest 2004 PASS / 6 SKIP，19 项 Node 测试 PASS（含未改动的 Claude 候选测试）。随后 API 错误合同检查发现新增响应缺少 code，首次门禁失败。补充 CODEX_RESPONSES_PROTOCOL_INVALID 后，错误合同及 2 项路由用例复跑通过，严格认证检查通过，Docker 内生产构建通过；未把分项复检写成整套门禁一次性通过。
- 官方固定版本 Codex App Server + 本地 Responses 模拟服务：真实请求 /v1/responses，使用预期测试密钥，原生 turn completed，输出 CODEX_API_NATIVE_OK。模拟服务不等同于真实外部模型服务。首次测试受继承代理环境影响超时；隔离测试代理后通过，没有改用户代理配置。
- localhost:3000 浏览器看到两种认证方式；API 模式出现已有凭据、密钥、提供商、模型、Base URL、连接测试。Custom 可选并显示手动模型字段。已有不兼容凭据不会被自动用于 Codex。
- 更新前控制数据库已备份并通过完整性检查，原实例目录保留。没有自动创建使用用户真实密钥的新 Agent。

DeepSeek/Kimi/MiniMax 的真实 Codex 模型执行、第三方工具调用、第三方流式恢复均为 NOT_RUN，需兼容端点与凭据后执行。默认模型目录读取与账号检查 UX 未在本轮扩大实现范围。没有推送 GitHub。
