import { dbAdapter } from "../../db";
import { supportsFeishu } from "../../utils/hermesCapabilities";
import { parseImageRef } from "./helpers";

type RuntimeImageSelection = {
  agent_image: string;
  agent_image_tag: string;
  agent_version: string;
  resolved_version: string | null;
  myBayVersions: any[];
};

type RuntimeImageSelectionResult =
  | { ok: true; selection: RuntimeImageSelection }
  | { ok: false; status: number; body: Record<string, unknown> };

export async function resolveCreateRuntimeImage(options: {
  data: any;
  secureData: any;
  userRole: string;
}): Promise<RuntimeImageSelectionResult> {
  const { data, secureData, userRole } = options;
  const canUseCustomAgentImage = userRole === "admin" || userRole === "super_admin";
  const systemDefaultAgentImage = process.env.MY_BAY_IMAGE || "nousresearch/hermes-agent";
  const requestedImage = canUseCustomAgentImage ? (data.image || "") : systemDefaultAgentImage;
  let { agent_image, agent_image_tag } = parseImageRef(requestedImage);

  if (data.imageTag) agent_image_tag = data.imageTag;
  if (!canUseCustomAgentImage) agent_image = systemDefaultAgentImage;

  let agent_version = agent_image_tag;
  let resolved_version: string | null = null;
  const isChannelFeishu =
    secureData.channel === "feishu" ||
    secureData.channel === "lark" ||
    (Array.isArray(secureData.channel) && secureData.channel.some((channel: any) => ["feishu", "lark"].includes(String(channel).toLowerCase()))) ||
    (secureData.configuredChannels && (
      (Array.isArray(secureData.configuredChannels) && secureData.configuredChannels.some((channel: any) => ["feishu", "lark"].includes(String(channel).toLowerCase()))) ||
      (typeof secureData.configuredChannels === "string" && (secureData.configuredChannels.toLowerCase().includes("feishu") || secureData.configuredChannels.toLowerCase().includes("lark")))
    ));
  const hasFeishuSkill = Array.isArray(secureData.skills) && secureData.skills.some((skill: string) =>
    ["feishu", "lark", "feishu_adapter", "lark_adapter"].includes(String(skill).toLowerCase())
  );
  const isFeishu = Boolean(isChannelFeishu || hasFeishuSkill);
  const myBayVersions = await dbAdapter.getMyBayVersions();

  if (!canUseCustomAgentImage && agent_image_tag !== "latest") {
    const isRegisteredTag = myBayVersions.some((version: any) => [
      version.image_tag,
      version.tag,
      version.version,
      version.coreVariant?.tag,
      version.feishuVariant?.tag,
    ].filter(Boolean).map(String).includes(String(agent_image_tag)));
    if (!isRegisteredTag) {
      return {
        ok: false,
        status: 400,
        body: {
          success: false,
          error: "AGENT_IMAGE_TAG_NOT_ALLOWED",
          message: "当前账号只能选择平台版本库中已登记的 Agent 镜像版本。请返回容器配置步骤重新选择版本。",
        },
      };
    }
  }

  if (isFeishu) {
    const { versionsRepo } = await import("../../repositories/versionsRepo");
    let matchingVersion: any = null;
    if (agent_image_tag === "latest") {
      matchingVersion = await versionsRepo.getResolvedLatestFeishuVersion();
      if (!matchingVersion) {
        return {
          ok: false,
          status: 409,
          body: {
            code: "FEISHU_CAPABILITY_REQUIRED",
            params: { version: "latest" },
            error: "No discovered official Hermes version supports Feishu/Lark.",
          },
        };
      }
    } else {
      matchingVersion = myBayVersions.find((version: any) => {
        const tag = version.image_tag || version.tag || version.version;
        return tag === agent_image_tag || version.version === agent_image_tag;
      });
      if (!matchingVersion) {
        return {
          ok: false,
          status: 400,
          body: {
            code: "VERSION_NOT_FOUND",
            params: { version: agent_image_tag },
            error: "The selected Hermes version is not registered.",
          },
        };
      }
      if (!supportsFeishu(matchingVersion)) {
        return {
          ok: false,
          status: 409,
          body: {
            code: "FEISHU_CAPABILITY_REQUIRED",
            params: { version: agent_image_tag },
            error: "The selected official Hermes version does not support Feishu/Lark.",
          },
        };
      }
    }
    agent_image = matchingVersion.image || systemDefaultAgentImage;
    agent_image_tag = matchingVersion.image_tag || matchingVersion.tag || matchingVersion.version;
    agent_version = matchingVersion.version || agent_image_tag;
    resolved_version = agent_version;
    console.log(`[Instance Create][Feishu] Using official Hermes image ${agent_image}:${agent_image_tag}`);
  } else if (agent_image_tag === "latest") {
    try {
      const { versionsRepo } = await import("../../repositories/versionsRepo");
      const resolvedLatest = await versionsRepo.getResolvedLatestCoreVersion();
      if (resolvedLatest?.image && resolvedLatest.image_tag) {
        agent_image = resolvedLatest.image;
        agent_image_tag = resolvedLatest.image_tag;
        agent_version = resolvedLatest.version || resolvedLatest.image_tag;
        resolved_version = resolvedLatest.version || resolvedLatest.image_tag;
        console.log(`[Instance Create] Resolved 'latest' to prewarmed version: ${resolved_version} (${agent_image}:${agent_image_tag})`);
      } else {
        console.warn(`[Instance Create] No prewarmed latest version found in db, fallback to DEFAULT_AGENT_IMAGE_TAG (${agent_image_tag})`);
      }
    } catch (error: any) {
      console.error(`[Instance Create] Failed to resolve latest version, fallback to ${agent_image_tag}`, error);
    }
  } else {
    const coreTag = agent_image_tag.endsWith("-feishu") ? agent_image_tag.replace(/-feishu$/, "") : agent_image_tag;
    const matchingCore = myBayVersions.find((version: any) => (version.image_tag || version.tag || version.version) === coreTag);
    if (matchingCore) {
      agent_image = matchingCore.image || agent_image;
      agent_image_tag = matchingCore.image_tag || matchingCore.tag || matchingCore.version;
      agent_version = matchingCore.version;
      resolved_version = matchingCore.version || matchingCore.image_tag;
    } else {
      agent_image_tag = coreTag;
      agent_version = coreTag;
      resolved_version = coreTag;
    }
  }

  return {
    ok: true,
    selection: { agent_image, agent_image_tag, agent_version, resolved_version, myBayVersions },
  };
}
