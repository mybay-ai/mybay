import { findRuntimeRelease, listRuntimeReleases } from "../../../shared/runtimeReleases";
import { parsePiRuntimeImageRef, resolveLocalPiImageRef } from "../localPiRuntime";

export type RuntimeUpgradeSelection = {
  runtimeType: string;
  image: string;
  tag: string;
  version: string;
  imageRef: string;
};

export type RuntimeUpgradeSelectionResult =
  | { ok: true; selection: RuntimeUpgradeSelection }
  | { ok: false; code: string; error: string };

export function isPiRuntimeInstance(instance: any): boolean {
  return String(instance?.runtime_type || "hermes").trim().toLowerCase() === "pi";
}

export function resolvePiRuntimeUpgradeSelection(options: {
  instance: any;
  targetTag: string;
  allowPreviousTag?: boolean;
}): RuntimeUpgradeSelectionResult {
  const requested = String(options.targetTag || "").trim();
  const configuredRef = resolveLocalPiImageRef();
  const configured = parsePiRuntimeImageRef(configuredRef);
  const release = findRuntimeRelease("pi", requested);

  if (release) {
    const isLatest = release.isLatest;
    const image = isLatest ? configured.image : release.image;
    const tag = isLatest ? configured.tag : release.imageTag;
    return {
      ok: true,
      selection: {
        runtimeType: "pi",
        image,
        tag,
        version: release.runtimeVersion,
        imageRef: isLatest ? configuredRef : `${image}:${tag}`,
      },
    };
  }

  const previousTag = String(options.instance?.previous_image_tag || "").trim();
  if (options.allowPreviousTag && previousTag && requested === previousTag) {
    const image = String(options.instance?.agent_image || configured.image).trim();
    const imageRef = `${image}:${previousTag}`;
    parsePiRuntimeImageRef(imageRef);
    return {
      ok: true,
      selection: {
        runtimeType: "pi",
        image,
        tag: previousTag,
        version: previousTag,
        imageRef,
      },
    };
  }

  return {
    ok: false,
    code: "PI_RUNTIME_VERSION_NOT_SUPPORTED",
    error: `Pi Runtime 仅允许升级到受支持版本 ${listRuntimeReleases("pi").filter((item) => item.upgradeable).map((item) => item.imageTag).join(", ")}；历史版本只能通过实例回滚入口恢复。`,
  };
}
