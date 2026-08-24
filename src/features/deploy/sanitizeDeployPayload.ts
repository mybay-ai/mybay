import type { SetupFormData } from "../../types";

const LOCAL_DEPLOY_FIELDS = [
  "runtime_type",
  "name",
  "path",
  "username",
  "password",
  "image",
  "imageTag",
  "port",
  "enableDashboard",
  "enableApi",
  "apiKey",
  "limitsCpu",
  "limitsMem",
  "limitsDiskMb",
  "provider",
  "model",
  "providerApiKey",
  "providerCredentialId",
  "baseUrl",
  "isCustomModel",
  "prompt",
  "channel",
  "channelMode",
  "allowMode",
  "gatewayAllowAllUsers",
  "skills",
  "skillTavilyApiKey",
  "skillSerperApiKey",
  "skillGithubToken",
  "template_id",
  "blueprint_id",
  "template_inputs",
  "pet",
  "learn",
] as const satisfies readonly (keyof SetupFormData)[];

const CHANNEL_FIELDS = {
  telegram: ["telegramBotToken", "telegramAllowedUsers", "telegramAllowedChats"],
  feishu: ["feishuAppId", "feishuAppSecret", "feishuRegion", "feishuAllowedUsers", "feishuAllowedChats"],
  weixin: ["weixinAccountId", "weixinToken", "weixinBaseUrl", "weixinAllowedUsers", "weixinAllowedChats"],
  slack: ["slackBotToken", "slackSigningSecret", "slackAppToken", "slackAllowedUsers", "slackAllowedChannels"],
  discord: ["discordBotToken", "discordAllowedGuilds", "discordAllowedUsers", "discordAllowedChannels"],
  webhook: ["webhookUrl", "webhookSecret", "webhookAllowedUsers", "webhookAllowedChannels"],
  whatsapp: ["whatsappPhoneNumberId", "whatsappAccessToken", "whatsappAllowedUsers", "whatsappAllowedChannels"],
  dingtalk: ["dingtalkAppKey", "dingtalkAppSecret", "dingtalkRobotSecret", "dingtalkAllowedUsers", "dingtalkAllowedChats"],
  qq_bot: ["qqBotAppId", "qqBotSecret", "qqBotAllowedUsers", "qqBotAllowedGuilds", "qqBotAllowedChannels"],
  wechat_mp: ["wechatMpAppId", "wechatMpAppSecret", "wechatMpToken", "wechatMpEncodingAesKey", "wechatMpAllowedUsers", "wechatMpAllowedChats"],
  wecom: ["wecomAppId", "wecomAppSecret", "wecomAgentId", "wecomToken", "wecomEncodingAesKey", "wecomAllowedUsers", "wecomAllowedChats"],
} as const satisfies Record<string, readonly (keyof SetupFormData)[]>;

function copyDefinedField(
  source: Partial<SetupFormData>,
  target: Partial<SetupFormData>,
  field: keyof SetupFormData,
) {
  if (Object.prototype.hasOwnProperty.call(source, field) && source[field] !== undefined) {
    (target as Record<string, unknown>)[field] = source[field];
  }
}

export function sanitizeDeployPayload(data: Partial<SetupFormData>): Partial<SetupFormData> {
  const payload: Partial<SetupFormData> = {};
  for (const field of LOCAL_DEPLOY_FIELDS) copyDefinedField(data, payload, field);

  // Open source deployment is BYOK-only. Platform model identifiers, credit multipliers,
  // entitlements, UI state, and proxy/preflight state are intentionally not request fields.
  payload.modelBillingMode = "byok";

  const channel = String(payload.channel || "none").toLowerCase();
  const activeChannel = channel === "lark" ? "feishu" : channel;
  const activeFields = CHANNEL_FIELDS[activeChannel as keyof typeof CHANNEL_FIELDS] || [];
  for (const field of activeFields) copyDefinedField(data, payload, field);

  return payload;
}
