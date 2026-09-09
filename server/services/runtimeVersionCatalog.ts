import { CODEX_BUILD } from "../../shared/codexBuild";
import { listRuntimeReleases } from "../../shared/runtimeReleases";
import { parsePiRuntimeImageRef, resolveLocalPiImageRef } from "./localPiRuntime";

export type RuntimeVersionRow = {
  runtime_type: string;
  bridge_version?: string;
  image_id?: string;
  repo_digests?: string[];
  upgradeable?: boolean;
  familyVersion: string;
  version: string;
  tag: string;
  image_tag: string;
  image: string;
  changelog: string;
  changelog_zh: string;
  published_at: string;
  releaseAt: string;
  channel: string;
  certification_level: string;
  is_latest: boolean;
  is_prerelease: boolean;
  is_prewarmed: boolean;
  prewarm_status: string;
  capabilities: string[];
};

export function listManagedRuntimeVersions(runtimeType: string): RuntimeVersionRow[] {
  const normalized = String(runtimeType || "").trim().toLowerCase();
  if (normalized === "codex") return [{
    runtime_type: "codex", familyVersion: CODEX_BUILD.nativeVersion,
    version: CODEX_BUILD.nativeVersion, tag: CODEX_BUILD.imageTag,
    image_tag: CODEX_BUILD.imageTag, image: CODEX_BUILD.image,
    bridge_version: CODEX_BUILD.bridgeVersion, upgradeable: false,
    changelog: "Pinned local build; upgrade and rollback are not yet validated.",
    changelog_zh: "当前固定的本地构建；升级与回滚尚未通过验证。",
    published_at: "", releaseAt: "", channel: "experimental",
    certification_level: "experimental", is_latest: true, is_prerelease: true,
    is_prewarmed: false, prewarm_status: "unknown", capabilities: ["core", "streaming", "cancellation", "files"],
  }];
  if (normalized !== "pi") return [];

  const configured = parsePiRuntimeImageRef(resolveLocalPiImageRef());
  return listRuntimeReleases("pi")
    .filter((release) => release.upgradeable)
    .map((release) => {
      const image = release.isLatest ? configured.image : release.image;
      const imageTag = release.isLatest ? configured.tag : release.imageTag;
      return {
        runtime_type: release.runtimeType,
        familyVersion: release.runtimeVersion,
        version: release.runtimeVersion,
        tag: imageTag,
        image_tag: imageTag,
        image,
        changelog: release.changelog,
        changelog_zh: release.changelogZh,
        published_at: `${release.releasedAt}T00:00:00.000Z`,
        releaseAt: release.releasedAt,
        channel: release.channel,
        certification_level: release.certificationLevel,
        is_latest: release.isLatest,
        is_prerelease: release.channel !== "stable",
        is_prewarmed: false,
        prewarm_status: "unknown",
        capabilities: ["core", "streaming", "cancellation", "files", "a2a", "backup", "upgrade", "rollback"],
      };
    });
}

type RuntimeImageInspector = {
  getImage(imageRef: string): { inspect(): Promise<unknown> };
};

export async function enrichRuntimeVersionCacheStatus(
  versions: RuntimeVersionRow[],
  imageInspector: RuntimeImageInspector,
): Promise<RuntimeVersionRow[]> {
  return Promise.all(versions.map(async (version) => {
    try {
      const info = await imageInspector.getImage(`${version.image}:${version.tag}`).inspect() as { Id?: unknown; RepoDigests?: unknown };
      return { ...version, is_prewarmed: true, prewarm_status: "cached",
        image_id: typeof info?.Id === "string" ? info.Id : undefined,
        repo_digests: Array.isArray(info?.RepoDigests) ? info.RepoDigests.filter((value): value is string => typeof value === "string") : [],
      };
    } catch (error: any) {
      if (error?.statusCode === 404) {
        return { ...version, is_prewarmed: false, prewarm_status: "idle" };
      }
      return version;
    }
  }));
}
