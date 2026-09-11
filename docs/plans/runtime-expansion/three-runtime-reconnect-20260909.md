# Hermes / Pi / Codex reconnect hardening

Claude integration is paused at the user's request. This work changes the shared event consumer used by the three admitted Runtimes; it does not expand their declared capabilities or certification.

## Problem and changes

Pi and Codex bridges emit numeric SSE event IDs and replay retained events on connection. The control-plane parser previously discarded those IDs. Reconnecting the same upstream run could append text again and replay approval requests.

The parser now retains the highest delivered numeric ID per local run and upstream identity for the current control-plane process. Replayed numeric IDs are ignored. Switching instance/upstream identity aborts the old connection and resets the cursor; late bytes from the old connection are rejected. A synchronous consumer failure aborts delivery without advancing the cursor. Clearing run caches also clears cursors. Events without positive safe-integer IDs retain the previous parsing behavior.

The shared normalized event interpreter also rejects explicit foreign `run_id` values before publishing text, approvals or terminal results. The test matrix now explicitly includes Hermes, Pi and Codex adapters.

## Validation

- PASS: targeted parser, three-Runtime event interpretation and reconciler SSE tests, 69 tests across 3 files.
- PASS: lease, upstream recovery, Driver compatibility, event and terminalization regression tests, 28 tests across 5 files.
- PASS: focused ESLint, main TypeScript check and whitespace check.
- First full release gate: FAIL at Vitest, 360 files passed / 1 failed / 1 skipped; 1,990 tests passed / 2 failed / 6 skipped, 438.82 seconds. Both failures were the unchanged 5,000 ms timeouts in `server/deploymentLifecycle.test.ts` (expired deployment lease recovery and pending-task cancellation), observed at 7,372 ms and 8,494 ms. No timeout or deployment code was changed.
- Exact deployment test file rerun: PASS, all 15 tests, 16.87 seconds total. This does not establish the cause of the earlier timeouts and does not turn the first full gate into PASS.
- PASS: remaining checks run separately, including 19 Node bridge tests, encoding/copy/i18n/API error contracts, production build, and strict existing Runtime certification. Main and both strict TypeScript checks and full lint also passed before the first Vitest run. The complete gate was not repeated after the isolated timeout rerun.
- Logs retained locally: `tmp/runtime-expansion/three-runtime-reconnect-gate.log`, `three-runtime-deployment-recheck.log`, and `three-runtime-remaining-checks.log` in the same directory.

These are source/protocol checks. Native model execution, Docker/browser disconnect acceptance and control-process restart acceptance were NOT RUN. The replay cursor is in memory, not a durable native event cursor; this does not claim restart-safe exactly-once delivery. No new A2A support, deployment, release or certification is claimed. Existing Claude candidate files were preserved without further implementation.
