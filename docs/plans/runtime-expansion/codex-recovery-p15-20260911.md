# Codex P1.5 中断与恢复验收报告

日期：2026-09-11
结论：**本阶段 PASS，Codex 继续维持 Beta。**

## 验收对象

- MyBay：`0.1.29-preview.1`，控制端镜像 `mybay/local:0.1.29-preview.1-p15`
- Codex Runtime：`mybay/codex-runtime:0.154.0`
- Codex Runtime 镜像 ID：`sha256:20b46c8407fa9f4a40435653db85b00518d9fff132a7333b9482246357f42256`
- 模型与认证：`gpt-6-astra`，现有 ChatGPT OAuth 账号
- 环境：Windows 10 Pro x64 + Docker Desktop 29.7.2

## 结果

| 场景 | 观察结果 | 结论 |
| --- | --- | --- |
| Runtime 执行中重启 | 首批文本后重启 Runtime；原 Run 自动收敛为 `failed / UPSTREAM_FAILED`，部分文本保留；未发送 stop | PASS，失败闭合 |
| Runtime 重启后续聊 | 同一 MyBay 会话和原生 Codex 会话完成新 Run，并准确回忆首轮随机标记 | PASS |
| 控制端执行中重启 | 首批文本后重启控制容器；恢复后继续接收文本并自然完成；未发送 stop | PASS，自动恢复 |
| 控制端重启后续聊 | 同一会话完成新 Run，并准确回忆首轮随机标记 | PASS |
| 浏览器错误提示 | 真实浏览器显示中断原因、保留部分输出、重试提示和错误码，后续成功消息及 `gpt-6-astra` 同时可见 | PASS |
| 停止写入后的恢复点 | 控制数据库完整性为 `ok`，保存数据库 SHA-256 和 303 个 Codex 实例文件的逐文件哈希 | PASS |

Runtime 中断的首字符耗时为 4119 ms，重启耗时为 862 ms。控制端中断的首字符耗时为 3011 ms，控制端恢复健康耗时为 4546 ms。控制端恢复后文本从 42 bytes 增长到 5944 bytes，并自动完成。

初次控制端中断测试要求输出 800 行，150 秒内没有自然结束，测试脚本随后发送了 stop。该次 Run `c6a8e2ae-c805-4261-9b3e-00d6ebad40ce` 明确排除，不用于证明自动恢复；最终结论来自缩短任务后自然完成且未发送 stop 的复测。

## 本轮修复

`UPSTREAM_FAILED` 原先只提示检查模型配置和额度，无法解释 Runtime 重启导致的真实故障。本轮改为说明 Runtime、模型服务或网络异常，告知用户部分输出已经保留，并引导检查实例状态后重试。针对错误映射的 14 个测试、ESLint、TypeScript、生产构建、Docker 健康检查和真实浏览器检查均通过。

## 认证边界

本轮证明了当前 Codex Runtime 在 Runtime 中断与控制端中断下的执行收敛和会话连续性。它没有完成以下 Certified 条件：

- 当前精确 Runtime 镜像的独立服务全量恢复演练；
- 控制端部署证据与安全检查证据的认证文件对齐；
- Windows 原生数据到 Linux 容器的跨平台恢复，该路径仍不支持。

因此本轮不修改 Codex 的 Beta 等级。下一步应以当前镜像 ID 创建隔离恢复目标，恢复控制数据库、Codex 状态与工作区，验证 OAuth、同一会话、随机标记和文件哈希，再补齐 `backup-restore`、`control-plane-deploy` 与 `security` 证据。

结构化证据：`certification/artifacts/codex-0.154.0-recovery-p15-windows-x64-20260911.json`
