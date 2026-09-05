# Script guide

This directory contains build, verification, release, Windows deployment, and recovery tooling used by MyBay. Some files run in the shipped application or installer, so do not treat the directory as development-only code.

[中文说明](#中文说明) · [English](#english)

## 中文说明

### 常用入口

优先通过 `package.json` 中的 npm 命令运行脚本，避免遗漏参数或前置步骤。

| 目的 | 命令 | 说明 |
| --- | --- | --- |
| 完整质量门禁 | `npm run check` | 执行 Runtime、文档、类型、测试、i18n、API 契约和构建检查 |
| Runtime 清单检查 | `npm run runtime:check` | 检查共享 Runtime 能力清单和认证数据 |
| Runtime 严格认证 | `npm run runtime:certify` | 要求认证记录满足严格规则 |
| 文档生成 | `npm run docs:build` | 校验文档并生成搜索索引和清单 |
| 站点预渲染 | `npm run site:prerender` | 必须先执行 `npm run build`；生成静态页面和 sitemap |
| 运维诊断 | `npm run doctor` | 检查本地数据、SQLite 和 Docker 状态 |
| 备份与恢复 | `npm run backup` / `npm run backup:verify` / `npm run backup:restore` | 创建、验证或恢复到新的目录，不覆盖已有目标 |
| Windows 发布包 | `npm run release:create-windows` | 只打包 Windows 用户实际需要的启动和诊断脚本 |
| 源码发布包 | `npm run release:create` | 打包经过 Git 跟踪且符合发布过滤规则的源码 |

### 自动化检查

- `check-*.mjs` 及其测试负责版本、发布包、乱码、i18n、本地版文案和 API 错误契约。
- `runtime-catalog.ts`、`runtime-certification.ts` 生成或验证 Runtime 能力与认证文档。
- `docs-build.ts` 构建文档索引；`prerender.ts` 在 Vite 构建后生成公共静态页面。
- `security-smoke-test.mjs`、`recovery-runtime-smoke.mjs`、`service-*-docker-smoke.mjs` 和 `run-file-snapshots-smoke.ts` 由 CI 验证安全与隔离边界。
- `*.test.ts`、`*.test.mjs`、`*.test.ps1` 和 `*.test.sh` 是对应脚本的自动化测试。

### Windows 安装与运维

- `quick-start-env.ps1` / `quick-start-env.sh`：解析快速启动需要的环境配置。
- `windows-preflight.ps1`：检查 Windows、内存、虚拟化、WSL 与 Docker 前置条件，必要时通过管理员权限完成系统配置。
- `windows-prerequisites.ps1`：执行 Windows 功能和 WSL 前置安装。
- `windows-control.ps1`：供启动、停止、日志、修复、卸载和诊断批处理入口调用。
- `windows-acceptance.ps1`：收集 Windows 安装验收证据。

Windows ZIP 使用 `create-windows-release.mjs` 中的白名单，只包含终端用户需要的脚本。修改文件名或路径时，必须同步更新该清单、批处理入口和 CI。

### 手工诊断工具

以下命令不会加入默认 `npm run check`，因为它们需要特定数据、Linux 或本地 Hermes 镜像：

- `npm run probe:hermes-question -- <local-image-id-or-tag>`：在隔离容器中探测 Hermes 问题协议，不拉取镜像、不挂载主机目录、不开端口。
- `npm run smoke:run-file-snapshots`：在 Linux 上验证运行文件快照的隔离、大小和敏感内容边界；CI 会自动执行。
- `npm run verify:local-migration -- [legacy-json] [sqlite]`：只读比较旧 JSON 数据与 SQLite 迁移结果。

### 高权限恢复脚本

`mybay-service-recovery.mjs` 可以访问 Docker Socket，并可能创建、重命名或切换容器。它只应通过受控恢复流程运行：先生成并审核 plan，再使用匹配的确认摘要执行后续阶段。不要绕过独立 helper、停止写入、备份验证、状态锁或回滚检查。

移动本目录文件时，还要检查 `package.json`、`.github/workflows/`、`Dockerfile`、快速启动脚本和发布清单中的路径。

## English

### Main entry points

Run scripts through the npm commands in `package.json` whenever possible so required arguments and prerequisite steps remain consistent.

| Purpose | Command | Notes |
| --- | --- | --- |
| Full quality gate | `npm run check` | Runs Runtime, docs, type, test, i18n, API-contract, and build checks |
| Runtime catalog validation | `npm run runtime:check` | Validates the shared Runtime capability catalog and certification data |
| Strict Runtime certification | `npm run runtime:certify` | Requires certification records to satisfy strict rules |
| Documentation generation | `npm run docs:build` | Validates docs and writes search indexes and manifests |
| Site prerendering | `npm run site:prerender` | Run `npm run build` first; writes static pages and a sitemap |
| Operational diagnostics | `npm run doctor` | Checks local data, SQLite, and Docker state |
| Backup and restore | `npm run backup` / `npm run backup:verify` / `npm run backup:restore` | Creates, verifies, or restores into a new destination |
| Windows release archive | `npm run release:create-windows` | Includes only scripts required by the Windows user flow |
| Source release archive | `npm run release:create` | Packages tracked source files that pass release filters |

### Automated checks

- `check-*.mjs` and their tests cover versions, release archives, mojibake, i18n, local-edition copy, and API error contracts.
- `runtime-catalog.ts` and `runtime-certification.ts` generate or validate Runtime capability and certification documents.
- `docs-build.ts` builds documentation indexes; `prerender.ts` generates public static pages after the Vite build.
- `security-smoke-test.mjs`, `recovery-runtime-smoke.mjs`, `service-*-docker-smoke.mjs`, and `run-file-snapshots-smoke.ts` verify security and isolation boundaries in CI.
- `*.test.ts`, `*.test.mjs`, `*.test.ps1`, and `*.test.sh` are automated tests for adjacent scripts.

### Windows installation and operations

- `quick-start-env.ps1` / `quick-start-env.sh`: resolve quick-start environment settings.
- `windows-preflight.ps1`: checks Windows, memory, virtualization, WSL, and Docker prerequisites and elevates only for required system configuration.
- `windows-prerequisites.ps1`: installs Windows features and WSL prerequisites.
- `windows-control.ps1`: powers the start, stop, logs, repair, uninstall, and diagnostics launchers.
- `windows-acceptance.ps1`: collects Windows installation acceptance evidence.

The Windows ZIP uses the allowlist in `create-windows-release.mjs`, so end users receive only the scripts they need. When a file is renamed or moved, update that allowlist, the batch launchers, and CI together.

### Manual diagnostics

These commands are excluded from the default `npm run check` because they require specific data, Linux, or a local Hermes image:

- `npm run probe:hermes-question -- <local-image-id-or-tag>` probes the Hermes question protocol in an isolated container without pulling an image, mounting host paths, or opening ports.
- `npm run smoke:run-file-snapshots` validates run-file snapshot isolation, size, and sensitive-content boundaries on Linux; CI runs it automatically.
- `npm run verify:local-migration -- [legacy-json] [sqlite]` compares legacy JSON and SQLite migration results in read-only mode.

### Privileged recovery tooling

`mybay-service-recovery.mjs` can access the Docker socket and may create, rename, or switch containers. Use it only through the controlled recovery sequence: create and review a plan, then supply the matching confirmation digest. Keep the separate helper, stopped-writer checks, backup verification, state lock, and rollback checks intact.

When moving scripts, also update paths in `package.json`, `.github/workflows/`, `Dockerfile`, quick-start launchers, and release manifests.
