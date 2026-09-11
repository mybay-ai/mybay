# Runtime extension boundaries / Runtime 扩展边界

Runtime registration is explicit: add a reviewed definition to `shared/runtimeCatalog.ts`, implement a `RuntimeDriver` under `server/runtime/adapters/`, and register it in `server/runtime/runtimeRegistry.ts`. Persisted type, provider key and contract version must agree. A definition alone does not implement or certify a Runtime.

Runtime 通过 Catalog、Driver、Registry 显式接入。声明、持久化绑定和实际能力必须一致；注册成功不代表真实执行或认证通过。

## Execution and events / 执行与事件

The Driver owns native session preparation, dispatch/fallback behavior, event interpretation and transport. Core reconciliation, run persistence and terminal commits remain MyBay services. Keep native endpoints, schemas and compatibility handling in the adapter or its Bridge.

`server/runtime/events/NormalizedRunEvents.ts` implements the existing MyBay Runs vocabulary. Bridges emitting this vocabulary can use `normalizedRunEventProvider`; other native protocols must translate before using it, or implement `RuntimeRunEventProvider` directly.

| Incoming event | MyBay behavior |
| --- | --- |
| `message.delta` | Accumulate and emit text; retain protocol-leak protection |
| `run.created`, `run.queued`, `run.started` and running aliases | Emit lifecycle steps |
| `tool.started`, `tool.completed` and aliases | Pair native call IDs, sanitize metadata, retain confirmed file evidence |
| `step`, `step.started`, `step.completed`, `step.failed` | Sanitize and deduplicate steps |
| `approval.request` | Emit pending approval and waiting status |
| `approval.responded`, `approval.response` | Resolve the interaction; remain waiting while other approvals are pending, otherwise emit running status |
| Completed/failed/cancelled run events | Call authoritative terminal handling with the upstream run ID, usage and duration |

Each controller owns its trackers. Call IDs are scoped by run; clearing one run must not clear another controller or run. Keep raw tool arguments, secrets and unconfirmed file operations out of product events. A failed tool is not a confirmed file change.

每个事件 Controller 独立保存运行状态。保留工具调用身份、文件证据过滤、审批限制与真实用量来源；取消或失败不能归并为成功。

### Adapter recovery policy / 适配器恢复策略

The default normalized provider terminalizes failed events. An adapter may supply `shouldReconcileEmptyFailure` only for its verified native recovery case. The callback is considered only before text output; once output exists, the failure is committed normally. Hermes retains its decoder compatibility policy in `HermesRunEvents.ts`. Pi no longer imports Hermes code or silently applies that heuristic to its own terminal errors.

通用层默认提交失败终态。Hermes 的无输出解码错误恢复仍由 Hermes 适配器声明；Pi 不再继承这一专用判断。新增 Runtime 必须用自己的协议证据与测试决定是否需要恢复策略。

## Approvals, questions and cancellation / 审批、提问与取消

- Approval submission already resolves instance/run authority and routes through the persisted Driver binding. Its MyBay transport endpoint is `/v1/runs/:upstreamRunId/approval`, with `approval_id`, `choice`, and optional `resolve_all`. A new Bridge must map the requested scope to a supported native decision or reject it; never silently widen an approval. Current choice vocabulary: `once`, `session`, `always`, `deny`.
- Structured questions use `runQuestionsRepo`, authenticated internal callbacks, and conversation/run authority on the UI routes. They are not implemented by inventing a generic SSE question event. Existing native identity matching handles Hermes and Pi; a new Runtime must explicitly implement and test its identity mapping, callback credentials and readiness before declaring question support.
- `questionBridgeInstaller.ts` installs the Python plugin only for Hermes with an approved image. Managed Pi uses its native authenticated callback and is never offered a Hermes plugin installation. Unknown Runtime types cannot inherit plugin support merely by sharing an image.
- Stop acceptance is not stop completion. Retain the native upstream run ID and verify the terminal outcome through the existing stop/reconciliation path. Late events must not overwrite an authoritative cancelled result.
- If remote identity arrives after the parent stop, the group cancellation worker must select the same native/managed transport as immediate cancellation. A managed peer uses its existing Runtime stop path only after ownership, peer membership and tracking checks. Acceptance waits for a persisted confirmed cancellation rather than requiring the first stop response to contain a completed cancellation count.

审批的作用范围须与原生能力一致；不支持的决定应拒绝。提问须绑定正确会话与运行，独立验证回调身份和 readiness。取消需区分“请求被接受”和“执行已停止”。

## Product lifecycle / 产品生命周期

The Driver has no install/start/upgrade/backup methods. Container deployment, image verification, data ownership, upgrade/rollback and backup/restore still live in Docker/instance services. Pi-specific examples are `localPiRuntime.ts` and `PiRuntimeEnvironment.ts`. Extract a shared lifecycle interface only when a new deployable Runtime proves the common requirements; do not add placeholder methods.

隔离实例数据、凭据和会话目录。生命周期操作仍由现有实例服务负责；不能将 Driver 契约测试称为安装、备份恢复或跨平台认证。

## Admission / 准入

1. Keep unsupported capabilities closed. Do not register an executable Codex or Claude Code entry before implementation and real validation.
2. Run the shared Driver contract suite, event/file/interaction regression tests, and native Bridge tests. The normalized event suite exercises the common provider and both existing Runtime providers.
3. Run `npm run release:gate`; certification validation is distinct from fresh Runtime execution.
4. Verify the candidate bundle in the actual acceptance environment. Retain sanitized PASS/FAIL/NOT_RUN results with platform, versions, run IDs and scope.
5. Document protocol-specific failures and unrun scenarios. Existing Windows Docker evidence does not certify other platforms.

P1 changed no persisted schema, public capability declaration or Driver contract version. The subsequent P2 implementation is described below.

## P2 Codex implementation / P2 Codex 实施

Codex now has an isolated App Server bridge pinned to official CLI 0.154.0 with MyBay bridge 0.1.0-experimental.3, a registered Driver, account-import deployment, capability-based readiness, and same-host local upgrade and rollback. Deployment is available by default without an opt-in flag; exact Windows Docker Desktop evidence verifies the Runtime at Certified, including security and portable backup/restore with explicit OAuth rebinding. See [bridge boundaries](../runtime/codex-bridge/README.md). Claude Code is not implemented.

Approval resolution keeps the run waiting while another pending approval remains. Restart preserves completed session identity but explicitly fails an in-flight turn; no automatic tool replay is claimed. Native account and bridge state directories are excluded from the product file surface. Upgrade and rollback fail closed before lifecycle mutation.
