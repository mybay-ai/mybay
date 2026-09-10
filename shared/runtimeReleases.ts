import { CODEX_RUNTIME_DEFINITION, PI_RUNTIME_DEFINITION, type RuntimeCertificationLevel, type RuntimeType } from "./runtimeCatalog";

export interface RuntimeReleaseDefinition {
  readonly runtimeType: RuntimeType;
  readonly runtimeVersion: string;
  readonly image: string;
  readonly imageTag: string;
  readonly channel: "stable" | "beta" | "experimental";
  readonly certificationLevel: RuntimeCertificationLevel;
  readonly releasedAt: string;
  readonly changelog: string;
  readonly changelogZh: string;
  readonly isLatest: boolean;
  readonly upgradeable: boolean;
  readonly aliases: readonly string[];
}

function freezeRelease(release: RuntimeReleaseDefinition): RuntimeReleaseDefinition {
  return Object.freeze({ ...release, aliases: Object.freeze([...release.aliases]) });
}

/**
 * Runtime images which the control plane is allowed to deploy through the
 * version repository. Adding a release here makes it visible to the UI and to
 * the upgrade validator in the same application release.
 */
export const PI_RUNTIME_RELEASES: readonly RuntimeReleaseDefinition[] = Object.freeze([
  freezeRelease({
    runtimeType: "pi",
    runtimeVersion: PI_RUNTIME_DEFINITION.version,
    image: PI_RUNTIME_DEFINITION.runtime.image,
    imageTag: PI_RUNTIME_DEFINITION.runtime.tag,
    channel: "beta",
    certificationLevel: PI_RUNTIME_DEFINITION.release.certificationLevel,
    releasedAt: "2026-09-05",
    changelog: "Updated the certified Runtime to Pi Agent 0.85.1 while retaining streaming, cancellation, recovery, files, A2A, backup, upgrade and rollback.",
    changelogZh: "升级至 Pi Agent 0.85.1，并继续支持流式输出、任务停止、异常恢复、文件、A2A、备份、升级与回滚。",
    isLatest: true,
    upgradeable: true,
    aliases: [PI_RUNTIME_DEFINITION.version, PI_RUNTIME_DEFINITION.runtime.tag],
  }),
  freezeRelease({
    runtimeType: "pi",
    runtimeVersion: "0.85.0",
    image: PI_RUNTIME_DEFINITION.runtime.image,
    imageTag: "0.1.0-beta",
    channel: "beta",
    certificationLevel: "certified",
    releasedAt: "2026-09-04",
    changelog: "Initial certified MyBay Pi Runtime release with managed upgrade and rollback.",
    changelogZh: "首个通过 MyBay 认证的 Pi Runtime 版本，支持受控升级与回滚。",
    isLatest: false,
    upgradeable: true,
    aliases: ["0.85.0", "0.1.0-beta"],
  }),
  freezeRelease({
    runtimeType: "pi",
    runtimeVersion: "0.84.4",
    image: PI_RUNTIME_DEFINITION.runtime.image,
    imageTag: "0.84.4",
    channel: "beta",
    certificationLevel: "beta",
    releasedAt: "2026-08-28",
    changelog: "Compatibility release retained for controlled downgrade and rollback testing.",
    changelogZh: "保留的兼容版本，用于受控降级和回滚验证。",
    isLatest: false,
    upgradeable: true,
    aliases: ["0.84.4"],
  }),
]);

export const CODEX_RUNTIME_RELEASES: readonly RuntimeReleaseDefinition[] = Object.freeze([
  freezeRelease({
    runtimeType: "codex",
    runtimeVersion: CODEX_RUNTIME_DEFINITION.version,
    image: CODEX_RUNTIME_DEFINITION.runtime.image,
    imageTag: CODEX_RUNTIME_DEFINITION.runtime.tag,
    channel: "experimental",
    certificationLevel: "experimental",
    releasedAt: "2026-09-10",
    changelog: "Updates the pinned native Codex CLI to 0.154.0 and admits controlled local upgrade and rollback.",
    changelogZh: "将原生 Codex CLI 固定升级至 0.154.0，并开放受控的本地升级与回滚。",
    isLatest: true,
    upgradeable: true,
    aliases: [CODEX_RUNTIME_DEFINITION.version, CODEX_RUNTIME_DEFINITION.runtime.tag],
  }),
  freezeRelease({
    runtimeType: "codex",
    runtimeVersion: "0.153.4",
    image: CODEX_RUNTIME_DEFINITION.runtime.image,
    imageTag: "0.153.4",
    channel: "experimental",
    certificationLevel: "experimental",
    releasedAt: "2026-09-09",
    changelog: "Previous pinned Codex CLI build retained as the supported rollback point.",
    changelogZh: "保留上一版固定的 Codex CLI 构建，作为受支持的回滚点。",
    isLatest: false,
    upgradeable: true,
    aliases: ["0.153.4"],
  }),
]);

export function listRuntimeReleases(runtimeType: RuntimeType): readonly RuntimeReleaseDefinition[] {
  if (runtimeType === "pi") return PI_RUNTIME_RELEASES;
  if (runtimeType === "codex") return CODEX_RUNTIME_RELEASES;
  return Object.freeze([]);
}

export function getLatestRuntimeRelease(runtimeType: RuntimeType): RuntimeReleaseDefinition | null {
  const releases = listRuntimeReleases(runtimeType).filter((release) => release.upgradeable);
  return releases.find((release) => release.isLatest) || releases[0] || null;
}

export function findRuntimeRelease(
  runtimeType: RuntimeType,
  requestedVersion: string,
): RuntimeReleaseDefinition | null {
  const requested = String(requestedVersion || "").trim();
  const releases = listRuntimeReleases(runtimeType).filter((release) => release.upgradeable);
  if (requested === "latest") return getLatestRuntimeRelease(runtimeType);
  return releases.find((release) => (
    release.runtimeVersion === requested
    || release.imageTag === requested
    || release.aliases.includes(requested)
  )) || null;
}
