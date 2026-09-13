import type { SetupFormData } from "../../types";

/** Clear credentials belonging to channels that are no longer selected. */
export function switchDeployChannel(d: Partial<SetupFormData>, id: string) {
      const updated = { ...d, channel: id };

      // 1. Clean up fields of other channels
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

      // Remove fields of all channels EXCEPT the newly selected one
      Object.keys(channelFieldGroups).forEach(ch => {
        if (ch !== id) {
          channelFieldGroups[ch].forEach(field => {
            delete (updated as any)[field];
          });
        }
      });

      // Clear lark explicitly
      if (id !== "feishu" && id !== "lark") {
        delete (updated as any).larkAppId;
        delete (updated as any).larkAppSecret;
      }

      // If "none" or "web", clear allowMode and gatewayAllowAllUsers
      if (id === "none" || id === "web") {
        updated.gatewayAllowAllUsers = false;
        updated.allowMode = "disabled";
      }

      // If "feishu", set feishuRegion default
      if (id === "feishu") {
        updated.feishuRegion = d.feishuRegion || "feishu";
      }

      return updated;
}
