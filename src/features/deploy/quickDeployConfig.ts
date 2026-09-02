import { providerRegistry } from "../../../shared/providerRegistry";
import type { QuickDeployDraft } from "./quickDeployTypes";

export interface QuickDeployDefaultsInput {
  suffix?: string;
  password?: string;
  provider?: string;
  model?: string;
}

function compactSuffix(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "local";
}

export function createQuickDeployDraft(input: QuickDeployDefaultsInput = {}): QuickDeployDraft {
  const provider = input.provider && providerRegistry[input.provider]?.enabled ? input.provider : "deepseek";
  const providerConfig = providerRegistry[provider];
  const suffix = compactSuffix(input.suffix || crypto.randomUUID());

  return {
    schemaVersion: 1,
    runtimeType: "hermes",
    entrypoint: "web",
    name: `mybay-agent-${suffix}`,
    purpose: "",
    channel: "web",
    feishuRegion: "feishu",
    weixinBaseUrl: "https://ilinkai.weixin.qq.com",
    dashboardUsername: "admin",
    dashboardPassword: input.password || crypto.randomUUID(),
    modelStrategy: {
      mode: "saved_credential",
      credentialId: "",
      provider,
      model: input.model || providerConfig.defaultModel,
      baseUrl: providerConfig.defaultBaseUrl,
    },
    selectedSkillIds: [],
    permissionConfirmed: false,
  };
}

export function buildQuickDeployPath(name: string, suffix: string) {
  const stem = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "agent";
  return `${stem}-${compactSuffix(suffix)}`;
}
