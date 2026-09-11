# P1.4 Pi / Codex 首 Token 延迟验收

## 结果

P1.4 在 Windows Docker Desktop 的真实 Pi 与 Codex 实例上通过。共执行 24 个短回答请求，全部完成并返回精确随机标记。

控制端请求接受、文件快照、会话绑定和 Runtime 提交不是当前主要等待来源。真实首段文字主要耗时发生在 Runtime 已接收任务后的模型阶段，因此本轮保留 `balanced` 默认推理档位，没有加入会消耗额度和创建隐藏会话的自动模型预热。

## 冷热对照

| Runtime | 容器重启后首轮 | 热容器新会话中位数 | 同一原生会话热轮次中位数 | 会话复用降幅 |
| --- | ---: | ---: | ---: | ---: |
| Pi / deepseek-v4-flash | 4,484 ms | 4,767 ms | 1,899 ms | 60% |
| Codex / gpt-6-astra | 12,709 ms | 8,089 ms | 3,728 ms | 54% |

Pi 与 Codex 已经沿用原生会话并避免每轮重放 MyBay 历史，本轮数据验证了该路径的实际收益。新建原生会话仍需处理完整 Runtime 上下文；Codex 容器重启后的第一次模型请求还有额外冷启动成本。

## 本地链路

- 主矩阵的控制端接受请求中位数：Pi 约 103 ms，Codex 约 115 ms。
- 控制端接受 P95 门槛为 1,000 ms，首个生命周期反馈 P95 门槛为 1,500 ms，本轮通过。
- Runtime SSE 首事件通常在提交后数百毫秒内到达。
- `fast` 与 `balanced` 交替样本没有得到稳定的 `fast` 优势，因此不调整产品默认值。

## 工具与验证

- 新增通用验收工具 `scripts/runtime-first-token-acceptance.mjs`。
- 支持 Pi/Codex、共享会话/每轮新会话、轮数、目标地址和无正文证据输出。
- Node 语法检查、帮助命令和目标 ESLint 通过。
- 使用新脚本额外执行 Pi 2 轮、Codex 2 轮，4/4 完成且精确输出。
- 控制端 `mybay/local:0.1.29-preview.1-p13` 健康；两个目标 Runtime 重启后均保持运行。

结构化证据位于 `certification/artifacts/pi-codex-first-token-p14-windows-x64-20260911.json`。完整本地样本位于被 Git 忽略的 `data/p14-first-token-20260911/`，其中只将无正文、无凭据的汇总写入认证证据。
