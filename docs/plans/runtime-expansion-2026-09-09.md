# Runtime expansion execution / Runtime 扩展执行记录

## Scope / 范围

Integrate Codex first, then Claude Code, while preserving Hermes and Pi behavior. Admission requires real execution evidence, not catalog registration alone. Neither new Runtime is implemented or certified by this plan.

依次接入 Codex、Claude Code，保留 Hermes、Pi 现有行为。新 Runtime 的准入必须有真实执行证据，不能仅凭注册或单元测试声明可用。

## P0 baseline / 开发基线

- Date: 2026-09-09.
- Remote refreshed with `git fetch origin`.
- Remote main: `22b0c63`, including Pi integration and the v0.1.28 release.
- Selected source: `6c32798`, exactly one commit ahead of remote main: mixed Runtime A2A acceptance fixes.
- Package version: `0.1.28`. The source branch's `v0.1.29` suffix is not a published version or certification claim.
- Isolated worktree: `.codex-worktrees/runtime-expansion`.
- Branch: `mybay-runtime-expansion`. Git rejects `mybay/runtime-expansion` because the existing branch `mybay` occupies that ref namespace. No existing branch was renamed or deleted.
- Original checkout and the A2A/streaming source worktrees were clean at inspection.
- `files-a2a-hardening` had 68 tracked modifications and 11 untracked files. Its pending event journal, stream authentication, context compaction, and related changes are not part of this baseline. Leave that working tree intact; integrate those changes separately after review and validation. They are not superseded merely because this baseline was selected.
- Dependencies installed from the lockfile with `npm ci --ignore-scripts`.

## Validation boundaries / 验收边界

This run's source checks and live HTTP checks must be reported separately. Existing certification evidence is historical and remains restricted to its recorded version/platform. An existing Docker deployment is not a newly installed candidate; compare its server bundle to the candidate before attributing live results to the selected source. Browser acceptance, clean installation, and restart recovery are separate checks.

本轮源码检查、真实 HTTP 验收与历史认证证据分别记录。现有容器不代表全新安装；只有比对构建产物后才能将其运行结果归属到当前候选基线。浏览器、全新安装和重启恢复不以 HTTP 冒烟代替。

Local command logs and sanitized live reports are stored under the ignored `tmp/runtime-expansion/` directory. Retained evidence must omit credentials, cookies, raw provider responses, and private configuration.

## Execution gates / 阶段门槛

| Phase | Work | Exit condition |
| --- | --- | --- |
| P0 | Select and verify an isolated baseline | Source quality gate, strict evidence validation, and scoped real Hermes/Pi regression pass; preserve other working trees |
| P1 | Extract shared event handling and document interaction/lifecycle boundaries | Existing behavior preserved; native protocol details stay in adapters; contract and affected tests pass |
| P2 | Codex Bridge, Driver, deployment and UI integration | Real conversation, tools/files, approval rejection, cancellation, refresh and restart recovery; experimental/beta according to evidence |
| P3 | Claude Code Bridge and Driver | Same single-Runtime gate as Codex, with native differences retained |
| P4 | Four-Runtime collaboration | All 12 heterogeneous directed pairs; three-member partial failure; cancellation, isolation and recovery |
| P5 | Release candidate | Installation, upgrade/rollback, security, backup/restore, product E2E and strict release gate |

Do not widen the first release to scheduling, browser automation or IM channels unless those capabilities are separately implemented and verified. Credentials, working directories, sessions and tool events must remain isolated by instance and conversation.

首轮接入不默认开放定时任务、浏览器或 IM 渠道。审批拒绝、等待输入、失败和取消必须保留不同语义；不能把本地取消请求成功当作上游执行已经停止。

## Status / 状态

P0: PASS for isolated baseline admission (source gate plus the two-direction live HTTP smoke). P1: PASS for shared event extraction and the scoped regression below; P2-P5 are pending. This does not claim clean-install, browser or full lifecycle recertification.

P0 开发基线准入通过：独立工作树、完整源码门禁与双向真实 HTTP 冒烟已验证。P1 通用事件提取与本轮回归已完成；下一步为 P2 Codex 接入。本报告不代表新 Runtime 已实现或已发布。

### P0 results / P0 已取得结果

- `npm run release:gate`, first attempt: FAIL. Lint, catalog/docs checks and three TypeScript checks passed. Vitest: 357 files passed, one failed, one skipped; 1,896 tests passed, one failed, six skipped. The sole failure was the default 5,000 ms timeout in `chatRepo.test.ts` (terminal timeline atomic persistence), not an assertion mismatch.
- The exact failing test was rerun without changing source or timeout: PASS (1 test, 29 unselected; 1.92 seconds test duration). A complete gate recheck is required; this targeted success does not erase the initial failure.
- `npm run release:gate`, complete recheck: PASS (exit 0). Vitest: 358 files passed, one skipped; 1,897 tests passed, six skipped; 285.38 seconds. Subsequent encoding/copy/i18n/API contract checks, production build and strict certification all passed. No test timeout or application source was changed. Initial timeout remains recorded as a non-reproduced test stability observation.
- `node --test runtime/pi-bridge/server.test.mjs`: PASS, 16/16.
- `npm run build`: PASS.
- `npm run runtime:certify`: PASS, Hermes and Pi declared/verified certified for the existing evidence scope. This is evidence validation, not a fresh lifecycle certification.
- Live HTTP A2A: PASS for Hermes → Pi (51,741 ms) and Pi → Hermes (125,736 ms), including exact peer, member task terminal state, persisted room identity and group outcome. Remaining five scenarios were not selected: NOT_RUN. These durations are observations under concurrent local validation, not performance benchmarks.
- Retained live report: [p0-a2a-live-20260909.json](runtime-expansion/p0-a2a-live-20260909.json).
- Live report SHA-256: `05004eefd829bb804f12a0084572f9e9acf29b636313cf50791315036b29a6fd`.
- Target: existing loopback acceptance service `127.0.0.1:4348`, container `mybay-release-control-v0128`, only the two named acceptance instances. No container restart or replacement was performed.
- Candidate `dist/server.cjs`, the mounted source bundle and `/app/dist/server.cjs` inside the container all have SHA-256 `431c14cc4d85d7745f8c97c893d0eb223818fe6a7350d2ae3c55859be3786588`.
- Deployment metadata caveat: health reports `0.1.27.1` because the container retains that `package.json`; `server/appVersion.ts` reads package metadata at runtime. The matching server bundle supports scoped HTTP regression attribution, but this deployment is not a clean 0.1.28 installation or release certification.
- Fresh browser acceptance, clean installation, Runtime restart, cancellation and three-member partial failure: NOT_RUN in this P0 pass.
- Local raw validation logs: `tmp/runtime-expansion/p0-release-gate.log`, `p0-timeline-recheck.log`, `p0-release-gate-recheck.log`, `p0-pi-bridge.log`, `p0-build.log`, and `p0-a2a-live.log`. These logs remain outside Git; the sanitized live report above is retained in Git.
- Final scope: only this execution report and its sanitized evidence are added. Existing application source is unchanged. The other working tree still has the same 79 pending entries; no existing Runtime was restarted or replaced. No remote push, merge or release was performed.

### P1 implementation boundaries / 下一阶段代码边界

1. `PiRuntimeDriver.ts` currently imports the normalized event provider from the Hermes adapter. Extract reusable MyBay event handling to a neutral module. Keep Hermes decoder compatibility handling in its adapter through an explicit policy; do not accidentally apply that recovery heuristic to new Runtime protocols.
2. Preserve separate controllers and trackers per run; retain tool-call identity, file evidence sanitization, approval choice restrictions, usage provenance and authoritative terminal completion.
3. `questionBridgeInstaller.ts` recognizes specific Hermes images and a managed Pi label. New native question support must have an explicit capability/readiness path; do not install the Hermes plugin into a different Runtime.
4. Driver currently owns preparation, execution and event/transport interpretation. Container image build, data ownership and upgrade operations remain in services such as `localPiRuntime.ts`; design new deployment support around real requirements rather than adding unused lifecycle methods.
5. Codex integration research: [official App Server documentation](https://learn.chatgpt.com/docs/app-server), checked 2026-09-09. Validate the fixed CLI version's stdio handshake and generated protocol schemas before implementing its adapter. The transport supports bidirectional events/requests; native approval and interruption semantics require mapping and tests.

## P1 implementation / P1 实施

Base: `c5f6c49`. Changes are confined to the isolated expansion worktree.

- Extracted `NormalizedRunEventProvider` into `server/runtime/events/NormalizedRunEvents.ts`. The default provider has no adapter import or decoder heuristic. Its vocabulary, text/tool handling, sanitization, approval choices, usage and terminal persistence delegation are preserved.
- Hermes now supplies `shouldReconcileEmptyFailure` through its adapter. Empty-output decoder failures still request reconciliation; failures after output still terminalize.
- Pi imports the common provider directly. Intentional correction: a Pi terminal failure containing a Hermes decoder-error string is now a failed terminal event, rather than silently requesting Hermes-style recovery.
- Question plugin eligibility now requires both Hermes Runtime identity and the verified image. Install attempts for Pi or unknown Runtime types fail before Docker/filesystem mutation. Managed Pi callback health checks remain available without offering the Hermes plugin.
- Live regression exposed a pre-existing cancellation transport gap: remote task identity can arrive after the parent has stopped, but the background cancellation worker only used native A2A. The worker now uses the existing managed Runtime cancellation path for tracked managed peers, retaining owner, peer membership and remote terminal validation. This is a necessary cancellation-boundary correction found during P1.
- The cancellation acceptance runner now waits up to 60 seconds for persisted, confirmed remote cancellation. It requires the exact selected peer, member task ID, remote ID, finished record and cancelled host/group/member states. Immediate stop counters are retained as observations, not mistaken for terminal proof.
- Added [Runtime extension boundaries](../runtime-extension-guide.md), documenting actual approval/question/stop paths and the remaining product lifecycle boundary. This does not create new executable Runtime catalog entries, change persisted schemas, or claim a new certification level.

### P1 verification / P1 验证

- Focused contracts/events/file evidence/question health/integration suites: PASS, 7 files / 100 tests. Tests cover both real providers plus the neutral provider, run/controller isolation, failed-vs-cancelled terminals, usage, recovery policy scope and native Pi question readiness.
- TypeScript: PASS. Candidate production build: PASS.
- First full release gate: PASS, 1,946 tests passed / six skipped. Final full gate after the cancellation correction and timeout recheck: PASS, 1,950 tests passed / six skipped.
- Cancellation transport and acceptance tests after the correction: PASS, four files / 18 tests; includes delayed mapping, ownership/tracking rejection and refusal to accept incomplete cancellation evidence.
- Candidate live acceptance completed on the named `mybay-release-control-v0128` acceptance service. A temporary candidate replaces only that control container, using its existing image/dependencies and isolated acceptance database. The original container is retained for restoration; Hermes/Pi containers are not replaced. Database backup and runtime credentials remain in ignored local files/process memory.
- Fresh install, browser, native approval interaction E2E, three-member partial failure and multi-platform certification are not claimed by these checks.

### First live attempt / 首轮真实验收

Three scenarios passed (both directions and refresh recovery). Group cancellation failed: host cancelled, member/group unknown, immediate cancellation attempts zero. A later mapping showed the Pi task waiting for approval and background cancellation unconfirmed. The first report is retained separately; it is not overwritten by a successful rerun. The exact test-created native task was subsequently stopped and returned `cancelled`.

The temporary deployment helper initially referenced the original container by its old name after rename. Automatic restoration therefore failed after removing the candidate. The retained original container was immediately renamed back and started by its known identity; health was verified. The helper now holds the immutable original container ID. No original container, Runtime container or database was deleted.

### Final candidate live results / 最终候选真实验收

The same candidate server bundle, SHA-256 `5337313d0af3ebbb98f50ae8e76ae187dd32cf5e705b93830fa987ba0b7f987c`, passed Hermes → Pi, Pi → Hermes, group cancellation and refresh recovery across separate runs: aggregate 4 PASS / 0 FAIL / 3 NOT_RUN. This is not a single full-matrix pass. Parallel execution, three-member partial failure and control restart recovery were not selected in P1.

The second run passed both directions and confirmed remote cancellation, but failed refresh recovery because the host returned the marker without actually delegating. The runner prompt was clarified to require host delegation while restricting tools only for the member. A refresh-only rerun against the unchanged server bundle passed with a real completed remote task. All three reports, including both failures, are retained in [the validation manifest](runtime-expansion/p1-validation-20260909.json), with SHA-256 references.

Both final candidate deployments automatically restored the original control container and verified health. The original immutable container ID and Runtime containers were preserved. These checks used the existing acceptance environment; clean installation and browser acceptance remain NOT_RUN.

The full source gate after the cancellation fix initially reported 1,949 passed / one failed / six skipped. The sole failure was the original 5,000 ms timeout in `server/localStore.test.ts` (concurrent callers), observed at 5,692 ms while live acceptance was also running. The exact test passed on rerun in 3.92 seconds without changing source or timeout. The complete final gate was rerun separately from live I/O; its result is recorded below. This observation does not establish the timeout's cause.

Final `npm run release:gate` recheck: PASS (exit 0), 358 test files passed / one skipped; 1,950 tests passed / six skipped, 288.49 seconds. Lint, TypeScript, catalog/docs, encoding/copy/i18n/API contract checks, production build and strict existing certification validation passed. No test timeout was changed. Local log: `tmp/runtime-expansion/p1-release-gate-final-recheck.log`.

P1 is complete within the stated scope. Changes and sanitized evidence are recorded on the local expansion branch; no push, merge or release was performed. The original acceptance control is running healthy with the same immutable ID, and the other working tree retains 79 pending entries. P2 Codex implementation has not started.
