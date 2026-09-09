# Codex Runtime (Experimental)

An isolated adapter for the official `@openai/codex` App Server, pinned to 0.153.4. It does not connect to the Codex desktop daemon. Each instance owns its account directory, native threads, workspace and bridge state.

## Local deployment

Select Codex in Quick Deploy; no deployment opt-in flag is required. Choose account authentication or the shared API credential flow. Account mode imports `auth.json` from an existing Codex / ChatGPT login. API mode reuses a saved credential or API Key, model and Base URL, and writes an isolated native `config.toml` with `wire_api = "responses"`. API credentials are delivered through the instance environment, never embedded in TOML. Native token refreshes are preserved during account redeployment. Do not commit or publish account files, instance data or `.env` files.

API provider options come from the shared provider registry's Responses capability plus the custom-compatible endpoint option. A successful connection probe verifies the basic Responses result, not full tool/stream compatibility or external-provider certification. Switching to account mode clears the managed API provider configuration and excludes the API key from the generated environment.

The image is `mybay/codex-runtime:0.153.4`, built from this directory. It runs as a nonroot user with a read-only root filesystem and a writable, instance-specific `/opt/data` mount. `CODEX_BRIDGE_API_KEY` protects HTTP endpoints. `/health` proves process availability; `/capabilities` separately checks account readiness. Neither proves that a model request will succeed.

## Protocol boundaries

- Native `thread/start` / `thread/resume`, `turn/start`, incremental message and tool events.
- One-shot approval or denial only. Session, persistent and bulk grants are rejected.
- `turn/interrupt` accepts cancellation; only the native terminal event confirms it.
- Completed session history resumes after restart. An interrupted in-flight run is explicitly failed with `CODEX_BRIDGE_RESTARTED`; tools are not replayed automatically.
- SSE cursor replay and persisted run identity support reconnects.
- Structured questions, A2A, external channels, browser automation, schedules and automatic upgrades/rollback are closed.
- Maximum 200 retained runs per instance in this Experimental version. Capacity exhaustion is explicit; automatic retention cleanup is not implemented.
- Account import is not a new OAuth login flow. Reauthentication and account-switching UX remain future work.

Run bridge tests with `node --test runtime/codex-bridge/*.test.mjs` from the repository root. Tests and certification evidence are separate from fresh browser and platform acceptance.

中文：此版本为 Experimental。使用独立账号目录与原生会话，仅开放已实现的 Web 对话、工具、文件、单次审批和取消；不承诺跨平台认证、无损恢复正在执行的任务或升级回滚。

The Docker image uses the native `externalSandbox` turn policy: the nonroot Docker container, read-only root filesystem, capability restrictions and dedicated instance mount provide the execution boundary. This avoids nested namespace creation on Docker Desktop. Direct host tests retain Codex's native workspace sandbox by default. Never enable `CODEX_EXTERNAL_SANDBOX` for an unsandboxed host process.

When native command approval offers only `cancel` rather than `decline`, MyBay denial maps to cancellation of the native turn. It never grants permission. In this Experimental UI, choose **Agent execution** for account-backed Codex conversations; the separate direct-provider quick mode is not account-backed. Default-model identification can remain unknown in the UI; usage is retained from native events without inventing a model name.
