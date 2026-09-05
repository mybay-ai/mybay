import { PI_RUNTIME_DEFINITION, type RuntimeCertificationLevel, type RuntimeType } from "./runtimeCatalog";

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
    changelog: "Certified Pi Runtime integration with streaming, cancellation, recovery, files, A2A, backup, upgrade and rollback.",
    changelogZh: "完成 Pi Runtime 认证集成，支持流式输出、任务停止、异常恢复、文件、A2A、备份、升级与回滚。",
    isLatest: true,
    upgradeable: true,
    aliases: [PI_RUNTIME_DEFINITION.version, PI_RUNTIME_DEFINITION.runtime.tag],
  }),
]);

export function listRuntimeReleases(runtimeType: RuntimeType): readonly RuntimeReleaseDefinition[] {
  if (runtimeType === "pi") return PI_RUNTIME_RELEASES;
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
