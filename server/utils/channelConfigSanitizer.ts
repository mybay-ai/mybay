export function sanitizeChannelConfigForChannel(config: any) {
  if (!config) return config;

  const sanitized = { ...config };
  const channel = sanitized.channel || "web";
  sanitized.channel = channel;

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
    wechat_mp: ["wechatMpAppId", "wechatMpAppSecret", "wechatMpAllowedUsers", "wechatMpAllowedChats"],
    wecom: ["wecomAppId", "wecomAppSecret", "wecomAgentId", "wecomAllowedUsers", "wecomAllowedChats"]
  };

  const activeChannelGroup = channel === "lark" ? "feishu" : channel;

  // 1. Delete fields for other channels
  Object.keys(channelFieldGroups).forEach((ch) => {
    if (ch !== activeChannelGroup) {
      channelFieldGroups[ch].forEach((field) => {
        delete sanitized[field];
      });
    }
  });

  // 2. Extra explicit cleanup for Feishu / Lark fields
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
      delete sanitized[field];
    });
  }

  // 3. Clear everything if none
  if (channel === "none" || channel === "web") {
    Object.values(channelFieldGroups).flat().forEach((field) => {
      delete sanitized[field];
    });
    delete sanitized.larkAppId;
    delete sanitized.larkAppSecret;
  }

  // 4. Handle configuredChannels and configured_channels
  if (channel && channel !== "none" && channel !== "web") {
    sanitized.configuredChannels = [channel];
    sanitized.configured_channels = [channel];
  } else {
    delete sanitized.configuredChannels;
    delete sanitized.configured_channels;
  }

  return sanitized;
}
