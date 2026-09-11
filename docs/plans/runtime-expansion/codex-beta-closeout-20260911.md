# Codex Beta closeout — 2026-09-11

Codex native 0.154.0 with MyBay bridge 0.1.0-experimental.3 is now declared and verified at MyBay's Beta certification level for the exact retained Windows Docker Desktop image `sha256:20b46c8407fa9f4a40435653db85b00518d9fff132a7333b9482246357f42256`.

The earlier Experimental evidence already covered installation, real task submission, incremental output and cancellation. The v0.1.29-preview.1 candidate acceptance adds real session and restart recovery plus run-scoped usage with model and context-window identity. A separate real Codex run created a workspace file and produced three stable started/completed event pairs. The control plane confirmed the file through paired native event identity, persisted message evidence, a bounded before/after snapshot and final content hash.

Retained evidence:

- `certification/artifacts/runtime-v0129-preview1-candidate-20260910.json`
- `certification/artifacts/codex-0.154.0-beta-windows-x64-20260911.json`
- `certification/artifacts/codex-0.154.0-oauth-lifecycle-20260911.json`
- `certification/artifacts/codex-0.154.0-upgrade-rollback-windows-x64-20260911.json`
- `certification/evidence/codex.certification.json`

P0.3 added a credentialed browser-to-control-plane OAuth lifecycle acceptance. A rejected access token refreshed and completed in one turn, the rotated credentials survived a Runtime restart, rejected refresh credentials produced `CODEX_AUTH_REQUIRED` with a reconnect action, and the same conversation completed after rebinding the retained local encrypted credential. This satisfies the Certified-level `real-e2e` requirement for this exact Windows Docker Desktop target. The provider account was not globally revoked; that branch used a controlled instance-local rejected token pair.

`npm run runtime:certify` still reports declared `beta`, verified `beta`, exact image identity and verified publication status. This does not certify external IM channels, browser automation, scheduled tasks, Linux or macOS hosts, public image publication, or lossless recovery of an in-flight tool execution. Certified-level control-plane deployment, security, backup/restore, upgrade and rollback remain separate requirements even where older same-host evidence exists.

P0.4 hardened the shared local control-plane data path without raising Codex's certification level. Existing databases now pass a read-only SQLite `quick_check` before schema setup, corrupt input fails closed without replacement, graceful shutdown attempts a truncating WAL checkpoint, and the existing sealed backup/restore suite verifies the restored database again before publishing a new recovery directory. The ZIP import and preview path no longer depends on `adm-zip`; it uses bounded, memory-only `fflate` reads and never invokes a library filesystem extraction API. Production `npm audit` reports zero known vulnerabilities after the replacement. The active localhost database passed integrity validation while the current controller and Codex Runtime remained healthy; abrupt host loss and a stopped-writer whole-workspace cutover were not run in this increment, so the Codex `backup-restore` Certified requirement remains pending.

P1.1 completed a credentialed managed lifecycle rehearsal on Windows Docker Desktop. After establishing the retained 0.153.4 baseline, the same instance upgraded to 0.154.0 and rolled back to 0.153.4 through the product API. The MyBay conversation ID and native Codex session ID stayed unchanged; ChatGPT OAuth required no reauthorization; every retained run kept the configured `gpt-6-astra` evidence; and the same workspace file hash was observed before upgrade, after upgrade and after rollback. Stopped-writer backups at all three lifecycle points passed schema 8 integrity and manifest verification. These results satisfy the exact-image `upgrade` and `rollback` requirements. Backup restoration into a separate service, cross-platform migration and in-flight execution survival remain outside this acceptance.
