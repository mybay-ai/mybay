# Three-Runtime release closeout / 三 Runtime 发布收口

## Scope

Local working-tree audit and complete source gate, based on a3397bf plus pre-existing uncommitted changes. This is not a clean release artifact or new live lifecycle certification. Existing instances, credentials and Feishu bindings are preserved. No push or publication.

## Verified implementation boundaries

- Codex native dependency is pinned to @openai/codex 0.153.4 in runtime/codex-bridge/package.json and lockfile. The Runtime catalog, deployment selection, Docker labels and local image checker also pin 0.153.4.
- MyBay bridge revision is separately labeled 0.1.0-experimental.2. Native version alone does not identify locally rebuilt bridge code; retain image digest and source hashes for acceptance.
- Codex does not automatically follow desktop-app updates, ChatGPT authentication, or model selection. A supported upgrade requires native protocol compatibility, a built image, retained acceptance and explicit instance lifecycle support.
- runtimeVersionCatalog currently publishes managed Pi releases only. upgradeManager explicitly rejects Codex upgrade and rollback with CODEX_UPGRADE_NOT_AVAILABLE. This is an implementation boundary, not merely missing evidence.
- Config archive export scans designated upload/output directories and redacts credentials. It is not a complete Codex workspace/native-session backup. Do not equate config import with full recovery certification.

## Remaining release work

1. Complete source gate on the candidate, retaining first failures and reruns separately.
2. Define immutable Codex image revisions and admit a tested target and previous image before enabling upgrades; preserve credentials and native state, validate readiness, and test rollback on isolated instances.
3. Define and verify full backup/restore separately from portable redacted config export. Restore must preserve Runtime identity, keep private state private, and avoid reactivating a duplicate Feishu application binding.
4. Real Pi/Codex Feishu group stop and concurrent conversation isolation, followed by network-interruption/retry acceptance. Current private stop and group text results remain scoped to their earlier evidence.
5. Run clean packaged-image acceptance and update certification only for actually covered requirements.

## Source gate

- First full gate: FAIL, 367 files passed / 1 failed / 1 skipped; 2035 tests passed / 1 failed / 6 skipped. The outdated Agent-card presentation test still asserted fixed three-column classes, old height and inline redeploy. Updated it to retain primary-action and drawer callback checks without freezing CSS dimensions.
- Full recheck: FAIL, same counts; the presentation test passed, but chatRepo project/pin placement exceeded its unchanged 5000 ms timeout (observed 7233 ms). Exact chatRepo file plus presentation file rerun: PASS, 2 files / 32 tests. Cause remains unresolved; this does not convert the full gate to PASS.
- Remaining checks: native bridges PASS, 46 tests (includes existing paused Claude fixture tests, not Claude admission). Encoding, edition copy and locale parity passed. Fallback check found redundant Chinese defaultValue on the new More label; removed it because both locale keys already exist.
- After that correction: fallback and API error checks, production build and strict existing certification PASS. Targeted ESLint PASS. The final complete gate was not rerun; release remains blocked on a clean complete pass and the lifecycle evidence listed above.
- Logs: tmp/runtime-expansion/three-runtime-closeout-gate.log, three-runtime-closeout-gate-recheck.log, three-runtime-closeout-targeted.log, three-runtime-closeout-remaining.log, three-runtime-closeout-remaining-recheck.log.
- No Runtime image or running container was changed in this closeout pass. No new live model, backup/restore, upgrade/rollback or Feishu message acceptance was performed.
