import { PI_RUNTIME_DEFINITION } from "../../../shared/runtimeCatalog";
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
  const currentAliases = new Set([
    "latest",
    configured.tag,
    PI_RUNTIME_DEFINITION.runtime.tag,
    PI_RUNTIME_DEFINITION.version,
  ]);

  if (currentAliases.has(requested)) {
    return {
      ok: true,
      selection: {
        runtimeType: "pi",
        image: configured.image,
        tag: configured.tag,
        version: PI_RUNTIME_DEFINITION.version,
        imageRef: configuredRef,
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
    error: `Pi Runtime 仅允许升级到当前受支持版本 ${configured.tag}；历史版本只能通过实例回滚入口恢复。`,
  };
}

