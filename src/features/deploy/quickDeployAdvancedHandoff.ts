import type { SetupFormData } from "../../types";
import type { QuickDeployDraft } from "./quickDeployTypes";

export function buildQuickDeployAdvancedInitialData(
  draft: QuickDeployDraft,
  path: string,
): Partial<SetupFormData> {
  const common: Partial<SetupFormData> = {
    runtime_type: "hermes",
    name: draft.name.trim(),
    path,
    username: draft.dashboardUsername.trim(),
    password: draft.dashboardPassword,
    image: "nousresearch/hermes-agent",
    imageTag: "latest",
    enableDashboard: true,
    limitsCpu: "1",
    limitsMem: "1024MB",
    prompt: draft.purpose.trim(),
    channel: draft.channel,
    channelMode: draft.channel === "web" ? undefined : "production",
    allowMode: draft.channel === "web" ? "disabled" : "bind_later",
    gatewayAllowAllUsers: false,
    modelBillingMode: "byok",
    skills: [...new Set(draft.selectedSkillIds || [])],
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
