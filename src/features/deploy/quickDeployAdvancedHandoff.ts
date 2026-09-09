import type { SetupFormData } from "../../types";
import type { QuickDeployDraft } from "./quickDeployTypes";
import { getRuntimeDefinition } from "../../../shared/runtimeCatalog";

export function buildQuickDeployAdvancedInitialData(
  draft: QuickDeployDraft,
  path: string,
): Partial<SetupFormData> {
  const runtime = getRuntimeDefinition(draft.runtimeType);
  const isPi = draft.runtimeType !== "hermes";
  const channel = isPi ? "web" : draft.channel;
  const common: Partial<SetupFormData> = {
    runtime_type: draft.runtimeType,
    ...(draft.runtimeType === "codex" ? { codexAuthJson: draft.codexAuthJson } : {}),
    name: draft.name.trim(),
    path,
    username: isPi ? "" : draft.dashboardUsername.trim(),
    password: isPi ? "" : draft.dashboardPassword,
    image: runtime.runtime.image,
    imageTag: runtime.runtime.tag,
    enableDashboard: !isPi,
    limitsCpu: "1",
    limitsMem: "1024MB",
    prompt: draft.purpose.trim(),
    channel,
    channelMode: channel === "web" ? undefined : "production",
    allowMode: channel === "web" ? "disabled" : "bind_later",
    gatewayAllowAllUsers: false,
    modelBillingMode: "byok",
    skills: isPi ? [] : [...new Set(draft.selectedSkillIds || [])],
    telegramBotToken: draft.telegramBotToken?.trim(),
    telegramAllowedUsers: draft.telegramAllowedUsers?.trim(),
    telegramAllowedChats: draft.telegramAllowedChats?.trim(),
    feishuAppId: draft.feishuAppId?.trim(),
    feishuAppSecret: draft.feishuAppSecret?.trim(),
    feishuRegion: draft.feishuRegion || "feishu",
    feishuAllowedUsers: draft.feishuAllowedUsers?.trim(),
    feishuAllowedChats: draft.feishuAllowedChats?.trim(),
    weixinAccountId: draft.weixinAccountId?.trim(),
    weixinToken: draft.weixinToken?.trim(),
    weixinBaseUrl: draft.weixinBaseUrl?.trim() || "https://ilinkai.weixin.qq.com",
    weixinAllowedUsers: draft.weixinAllowedUsers?.trim(),
    weixinAllowedChats: draft.weixinAllowedChats?.trim(),
  };

  if (draft.modelStrategy.mode === "saved_credential") {
    return {
      ...common,
      providerCredentialId: draft.modelStrategy.credentialId.trim(),
      provider: draft.modelStrategy.provider.trim(),
      model: draft.modelStrategy.model.trim(),
      baseUrl: draft.modelStrategy.baseUrl?.trim(),
      isCustomModel: draft.modelStrategy.isCustomModel,
    };
  }

  return {
    ...common,
    providerApiKey: draft.modelStrategy.apiKey?.trim(),
    provider: draft.modelStrategy.provider.trim(),
    model: draft.modelStrategy.model.trim(),
    baseUrl: draft.modelStrategy.baseUrl?.trim(),
    isCustomModel: draft.modelStrategy.isCustomModel,
  };
}
