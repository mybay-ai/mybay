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

## Storage gate follow-up

- Found that createProject/createConversation still rewrote the entire store. Scoped them to their own collections using the existing transactional helper. A new regression test installs a SQLite trigger rejecting unrelated message deletion and checks reopened persistence.
- Isolated placement test: before 1895 ms, collection scoping alone 1906 ms; this did not show a measurable improvement for the empty fixture. Further inspection found per-table autocommit during schema initialization under synchronous=FULL.
- Batched schema DDL into one transaction, keeping WAL, FULL durability, failure rollback and future-schema rejection. Same test: 684 ms. These are single local observations, not a universal benchmark or proof of every historical timeout cause.
- The intermediate gate was intentionally interrupted before final schema changes; it is not a PASS.
- Final complete npm run release:gate: PASS, exit 0. Vitest: 368 files passed / 1 skipped, 2037 tests passed / 6 skipped, 213.34 seconds. Native Node tests: 19 passed. Lint, three TypeScript checks, catalog/docs, encoding/copy/i18n/API contract checks, build and strict existing certification passed.
- Log: tmp/runtime-expansion/chat-storage-final-gate.log. Timing logs: chat-placement-before.log, chat-placement-after.log, chat-placement-schema-after.log in the same local directory.
- This closes the current full-source-gate blocker for this working-tree candidate, not lifecycle certification. Codex upgrade/rollback and complete backup/restore remain unfinished. No live container was rebuilt, restarted or upgraded in this follow-up, and nothing was published.

## Codex build identity foundation

- Added runtime/codex-bridge/release.json as the shared native/bridge/image identity manifest, consumed by the Runtime catalog, deployment image selection, local image validator and bridge health response. Existing native version and image tag remain unchanged; this is not a native upgrade.
- Added a Node admission test validating the pinned dependency, lockfile and Docker labels against the manifest. Docker now copies the manifest into the image.
- The authenticated agent-versions endpoint accepts runtimeType=codex and returns the current build with upgradeable=false, Experimental status and bridge_version. Cache inspection adds actual Docker image_id and available repo_digests. Empty publication date reflects an unpublished local build. Backend upgrade/rollback denial remains intact.
- This is backend version identity/query support, not a completed version-repository UI or upgrade workflow. Current running containers are untouched.
- Validation: 3 focused Vitest files / 7 tests, 10 Codex Node tests, final version catalog 4 tests, TypeScript, targeted ESLint and production build passed. Full release gate not repeated after these localized changes; previous storage-gate PASS remains scoped to its candidate.
- Isolated image mybay/codex-runtime:version-candidate-20260910 built successfully (image config ID sha256:9597cb5dfd79353b930b57209ef91bbfb9c752ec564d8705d40dab1970c0f88e). A non-networked read-only temporary container loaded the release manifest successfully and was removed. No authenticated model execution was performed.
- Codex version UI: dedicated read-only tab, pinned native/bridge/tag/cache image ID and instance list; failed loads remain explicit. Corrected legacy runtime classification that counted Codex as Hermes. TypeScript, targeted lint, locale parity and build passed. Local control image mybay/local:codex-versions-20260910 deployed after confirming no active runs. Real browser verified Hermes/Pi/Codex tabs, Pi 0.85.1, Codex metadata and one instance, and 390px width without horizontal overflow. Agent containers were not recreated. Full release gate and live upgrade/rollback were not rerun.

## Native SQLite backup correction

- Existing full-system backup recursively preserves instance data, but skipped SQLite sidecars while copying native main files verbatim. Committed WAL-only native state could therefore be missing after restore.
- Instance files with the SQLite header now use the Node SQLite backup API and a sealed standalone snapshot before sidecars are omitted. Ordinary files keep exclusive copy and owner permissions; symlink rejection, hash verification and new-directory-only restore remain intact. This affects native SQLite files across Runtimes, not only Codex.
- Integration fixture keeps a native Codex-shaped SQLite database open with WAL autocheckpoint disabled, backs up and restores into a new directory, and verifies the committed thread row, synthetic auth, session JSONL, bridge state and workspace output. No real user credential was used.
- Backup/recovery suites: 22 PASS, 3 SKIP. Targeted ESLint passed. No live service was stopped or restored. Whole-workspace consistency still requires stopping writers; independent SQLite snapshots are not a cross-file transaction.
- Live authenticated Codex continuation after restore, duplicate Feishu binding suppression at service cutover, and upgrade/rollback remain NOT_RUN. Existing encryption key and images must be preserved separately as documented by the backup utility.
- TypeScript also passed. Full release gate was not rerun for this scoped CLI backup fix. Logs: tmp/runtime-expansion/codex-backup-tests.log, codex-backup-lint.log, codex-backup-typecheck.log.

## Live Codex native restore acceptance

PASS on Windows with pinned codex-cli 0.153.4 and the current bridge. An isolated copy of the previously authorized ChatGPT login created a new native session and remembered a random marker. The test process exited before backup. The backup utility restored into a different directory; a new process continued the stored session without reauthentication or injecting the marker into the second prompt.

- Before run: 779a7e86-cc76-4e3c-9c55-8f67b56d8364, completed.
- After run: e5f16880-7b4e-449b-9463-f2d073ff8654, completed.
- Same session and native thread; exact marker recalled; workspace file preserved; backup hash/integrity verification passed.
- Retained sanitized evidence: codex-restore-native-20260910.json, SHA-256 f9314f2f0c1922c0d4b4ad093c6f69b305569091a3b0c7f1f6daf6b261c381c0.
- Both test processes exited. Existing Agent containers and Feishu connections were untouched. Test credentials and raw state remain only in ignored local test directories, not this evidence or Git.
- Scope: real host-native model continuation after filesystem/database backup and restore. The small control metadata database was a fixture, not the real product database. Docker/product restore, service cutover, duplicate-binding handling and upgrade/rollback remain NOT_RUN. No certification level was raised, and no remote publication occurred.

## Docker native restore acceptance

PASS for Linux Docker to Linux Docker with candidate image mybay/codex-runtime:version-candidate-20260910. A fresh isolated authenticated Codex container created a native conversation, then was stopped and exported. The corrected backup/restore utility produced a new data directory, which was copied to another isolated Linux volume. The replacement nonroot container resumed the same native session/thread and recalled an unseen-in-the-second-prompt random marker. The final container export independently verified the workspace marker file.

- Before run b7a0b6f7-c946-4d83-b64b-2a939a92d30a; after run 05f93611-31c1-465a-84c1-379d6d0a9aa2; both completed.
- Session codex-v2-196e5742-4232-41f0-9a32-dff50dc668a1; native thread 01a08770-59b0-7c63-a155-aab4e01f5108; unchanged.
- Retained evidence: codex-docker-restore-20260910.json, including failed attempts. All test containers/volumes cleaned up. Existing instances and Feishu bindings untouched.
- The first Windows-native-to-Linux attempts failed native SQLite initialization, including after ownership preparation and use of a Linux volume. Cause remains unresolved; no cross-platform support is claimed.
- An initial same-platform export failed because Windows could not create Codex temporary executable symlinks. The isolated runner excludes the regenerable native tmp directory before stopped-container export. It also corrects helper ownership ordering and cleanup after export failure. These runner changes are not product lifecycle implementation.
- This is native Docker restore, not full MyBay product restoration: the control metadata database was a fixture. Actual product database cutover, duplicate IM binding handling, upgrade and rollback remain NOT_RUN. No certification change or publication.

## Full MyBay Codex product restore acceptance

PASS on the same Windows Docker Desktop host. An isolated MyBay control service created a fresh Codex conversation through the product API, received a random marker, and then stopped both control and Runtime writers. The full backup retained the MyBay SQLite database and the complete Codex instance directory. A second isolated control service loaded the restored database, recreated the Codex Runtime from the restored directory, opened the original conversation, and continued the same native thread without importing credentials again or placing the marker in the continuation prompt.

- Source MyBay Run `65e4c7f7-0785-42e5-8137-e4d74cb8ed57`; restored MyBay Run `e739428a-dfe8-46de-96ed-d5dbcf706530`; both completed.
- Native thread `01a088fa-03b9-7823-aaf0-6132d63bfd52` was unchanged. The exact marker was recalled and an existing workspace file had the same SHA-256 before and after restore.
- Backup verification passed at schema 8 with 635 files. The restored control login, instance readiness, conversation history and continuation were verified through product APIs.
- Real browser acceptance at the restored control showed the Codex instance running, the restored conversation in the recent list, and both the source and continuation replies with the exact marker.
- The restored instance used Web channel configuration. `managedFeishu.enabled` was false and the restored database contained zero channel authorization events, so the isolated copy did not establish a duplicate Feishu connection.
- Retained sanitized evidence: `docs/plans/runtime-expansion/codex-product-restore-20260910.json`.

The first product backup attempt was not usable: the old isolated control image lacked the current Feishu SDK, and the Codex native `tmp` subtree contained Windows-inaccessible temporary helper links. The backup utility now excludes only `instances/<id>/codex/tmp`, which Codex regenerates at startup. Targeted recovery tests and lint pass, and the successful backup manifest records the skipped subtree. The partial failed backup is retained only in the ignored local test directory.

Scope remains same-host restoration with the current encryption key and cached images preserved separately. Windows-native-to-Linux restore, Codex upgrade and rollback remain NOT_RUN. The isolated restored service stays on port 4362 for review; the main localhost:3000 service and existing Agent/Feishu instances were not changed.
