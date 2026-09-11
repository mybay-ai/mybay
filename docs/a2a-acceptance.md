# Mixed Runtime A2A acceptance / 混合 Runtime A2A 验收

This runner verifies MyBay's real HTTP, Runtime, and persisted recovery path. It does not infer success from configuration or host output alone.

此验收器验证 MyBay 的真实 HTTP、Runtime 与持久化恢复链路，不会仅凭配置存在或主持 Agent 输出推断成功。

## Evidence rules / 证据规则

- `PASS`: caller and peer are ready, the exact selected peer is persisted, the member task reaches the required terminal state, the group outcome agrees, and the acceptance marker is observed when applicable.
- `FAIL`: a selected scenario runs but any required observation is missing or contradictory.
- `NOT_RUN`: the scenario was not selected, is not implemented, or lacks required environment topology. `--strict` rejects both `FAIL` and `NOT_RUN`.

- `PASS`：调用方与成员均就绪、固化成员精确匹配、成员任务到达要求的终态、群组终态一致，并在适用场景中观察到验收标记。
- `FAIL`：已运行场景缺少任一必要证据，或证据互相矛盾。
- `NOT_RUN`：场景未选择、尚未实现，或环境拓扑不足。`--strict` 会同时拒绝 `FAIL` 与 `NOT_RUN`。

The report contains IDs, states, durations, and marker presence. Credentials remain in environment variables and are never written to the report.

报告只包含 ID、状态、耗时与标记是否命中。凭据仅从环境变量读取，不写入报告。

Managed member calls and reconnect polling share `MYBAY_A2A_TASK_WAIT_MS` (default 300000, bounded to 30000-900000). A Pi `waiting_for_approval` or `waiting_for_input` response is surfaced immediately as an actionable failed group outcome instead of being polled until timeout.

托管成员调用与断线恢复轮询共用 `MYBAY_A2A_TASK_WAIT_MS`（默认 300000，限制为 30000-900000）。Pi 返回 `waiting_for_approval` 或 `waiting_for_input` 时，会立即形成可处理的群组失败终态，不再轮询到超时。

## Run / 执行

Copy [`scripts/acceptance/a2a-mixed.example.json`](../scripts/acceptance/a2a-mixed.example.json) to an ignored local path and fill in the two deployed Runtime IDs and their configured A2A names. `controlContainer` is optional and enables the localhost Docker restart recovery scenario.

复制 [`scripts/acceptance/a2a-mixed.example.json`](../scripts/acceptance/a2a-mixed.example.json) 到 Git 忽略的本地路径，填写两台已部署 Runtime 的 ID 与 A2A 名称。`controlContainer` 为可选项，用于启用本机 Docker 控制面重启恢复场景。

```powershell
$env:MYBAY_ACCEPTANCE_USERNAME = "your-local-admin"
$env:MYBAY_ACCEPTANCE_PASSWORD = "your-local-password"
npm run acceptance:a2a -- --config .\tmp\a2a-config.json --output .\tmp\a2a-report.json
```

Select scenarios with a comma-separated list:

按逗号分隔选择场景：

```powershell
npm run acceptance:a2a -- --config .\tmp\a2a-config.json --output .\tmp\a2a-report.json --scenarios hermes-to-pi,pi-to-hermes,parallel,group-cancellation,refresh-recovery,control-restart-recovery
```

Use `npm run acceptance:a2a:strict -- ...` only when the configured environment can execute every declared scenario, including a three-member topology for `partial-failure`.

只有当环境能执行所有已声明场景（包括 `partial-failure` 所需的三成员拓扑）时，才使用 `npm run acceptance:a2a:strict -- ...`。

The retained Windows x64 two-Runtime result is [`certification/evidence/a2a-mixed.windows-x64.20260908.json`](../certification/evidence/a2a-mixed.windows-x64.20260908.json): six scenarios passed and `partial-failure` remained `NOT_RUN` because no third member was available.

已保留的 Windows x64 双 Runtime 结果见 [`certification/evidence/a2a-mixed.windows-x64.20260908.json`](../certification/evidence/a2a-mixed.windows-x64.20260908.json)：六个场景通过；由于缺少第三成员，`partial-failure` 保持 `NOT_RUN`。
