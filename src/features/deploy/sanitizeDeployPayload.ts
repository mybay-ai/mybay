import type { SetupFormData } from "../../types";

export function sanitizeDeployPayload(data: Partial<SetupFormData>): Partial<SetupFormData> {
  const payload = { ...data };
  const channel = payload.channel || "none";

  const channelFieldGroups: Record<string, string[]> = {
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
    wecom: ["wecomAppId", "wecomAppSecret", "wecomAgentId", "wecomToken", "wecomEncodingAesKey", "wecomAllowedUsers", "wecomAllowedChats"]
  };

  // Determine which fields we should KEEP based on the active channel
  // Note: if channel is 'lark', we might want to map to 'feishu' or keep its fields
  const activeChannelGroup = channel === "lark" ? "feishu" : channel;

  // 1. Delete fields for all other channels
  Object.keys(channelFieldGroups).forEach((ch) => {
    if (ch !== activeChannelGroup) {
      channelFieldGroups[ch].forEach((field) => {
        delete (payload as any)[field];
      });
    }
  });

  // 2. Extra explicit cleanup if NOT feishu/lark
  if (channel !== "feishu" && channel !== "lark") {
    const feishuAndLarkFields = [
      "feishuAppId",
      "feishuAppSecret",
      "feishuRegion",
      "feishuAllowedUsers",
      "feishuAllowedChats",
      "larkAppId",
      "larkAppSecret"
    ];
    feishuAndLarkFields.forEach((field) => {
      delete (payload as any)[field];
    });
  }

  // 3. If none, double check we cleared all groups
  if (channel === "none") {
    Object.values(channelFieldGroups).flat().forEach((field) => {
      delete (payload as any)[field];
    });
    // also clear any explicit lark fields
    delete (payload as any).larkAppId;
    delete (payload as any).larkAppSecret;
  }

  return payload;
}
