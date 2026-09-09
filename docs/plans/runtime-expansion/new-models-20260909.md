# 新模型接入记录（2026-09-09）

## 实现

- 共用目录增加 gpt-6-astra（OpenAI API 与 ChatGPT OAuth）和 gemini-3.8-flash。
- Anthropic 直连 Fable 5.1 修正为 claude-fable-5-1；OpenRouter 独立命名保留。
- 不更改已有实例的模型或默认模型；未加入未经官方确认的 DeepSeek 4.1。
- DeepSeek 保留 Chat Completions 默认地址，新增 Responses 专用地址 https://api.deepseek.com。Codex 创建及连接测试使用该地址，并兼容已保存凭据的旧 /v1 地址。
- Codex 写入 DeepSeek 原生模型目录，推理档位为 low/high/max，默认 high。
- Pi 0.85.1 本地目录识别 Astra、Fable 5.1、Gemini 3.8 Flash 和 DeepSeek V4；其 Anthropic 适配已有 adaptive thinking 分支。对 Gemini 3.8 Flash 将 minimal/off 映射 low，max/xhigh 映射 high。

## 验证

- TypeScript 检查通过；修改范围 ESLint 通过。
- 初轮定向测试 21 项通过；目录扩展导致旧的 Astra 排除断言失败，更新该预期后相关 15 项通过。
- Codex bridge 8 项通过，Pi bridge 18 项通过。
- 原生 Codex 加载 DeepSeek 模型目录并使用本地 Responses 协议测试服务：PASS。
- 真实 DeepSeek V4 Flash + Codex：流式回复 PASS、一次性审批后读取临时测试文件 PASS、同会话后续记忆 PASS。凭据仅在进程内解密，未写入报告。前两次工具测试停在审批，最终针对已核对的单文件读取命令放行后完成。
- 此真实验收使用本机 Codex 进程和隔离临时工作目录，经本地转发访问官方 DeepSeek Responses；不代表 Docker 新建实例的完整产品验收。
- Astra、Fable 5.1、Gemini 3.8 Flash 真实调用：NOT_RUN，本机无对应已保存凭据。DeepSeek V4 Pro/视觉版本真实调用未运行。
- Pi/Hermes 新模型真实工具及多轮验收未运行；本轮未宣称认证等级提升。

## 本地交付

- 控制面板镜像 mybay/local:new-models-20260909 已更新 localhost:3000，health 200 / healthy。
- Codex Runtime 0.153.4 镜像已重建，bridge 标识 0.1.0-experimental.2；Pi 0.85.1 镜像已重建。已有 Agent 容器未重启或替换，Pi 参数修复需更新实例镜像后生效。
- 浏览器确认 Codex 的 Astra 选项、DeepSeek 提供商、V4 模型列表及 Responses 地址。其他模型目录通过代码检查，未逐项浏览器验收。
- 未推送 GitHub。

## 官方依据

- https://developers.openai.com/api/docs/models/gpt-6-astra
- https://platform.claude.com/docs/en/models/fable-5-1/overview
- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
- https://api-docs.deepseek.com/guides/responses_api/
- https://api-docs.deepseek.com/quick_start/agent_integrations/codex/
