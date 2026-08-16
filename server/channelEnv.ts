import { decrypt } from "./crypto";

export function buildChannelRuntimeEnv(config: any): { [key: string]: string } {
  const env: { [key: string]: string } = {};

  const decryptSafe = (val: any) => val ? decrypt(val) : '';

  const isDisabled = config.allowMode === "disabled" || config.channel === "none" || config.channel === "web" || !config.channel;

  env.CHANNEL = config.channel || '';
  env.API_KEY = decryptSafe(config.apiKey);
  const rawChannelMode = config.channelMode || 'production';
  env.CHANNEL_MODE = rawChannelMode === 'testing' ? 'production' : rawChannelMode;
  env.GATEWAY_ALLOW_ALL_USERS = config.gatewayAllowAllUsers === true ? 'true' : 'false';

  if (!isDisabled) {
    const channel = config.channel;

    // Telegram
    if (channel === "telegram") {
      env.TELEGRAM_BOT_TOKEN = decryptSafe(config.telegramBotToken);
      env.TELEGRAM_ALLOWED_USERS = config.telegramAllowedUsers || '';
      env.TELEGRAM_ALLOWED_CHATS = config.telegramAllowedChats || '';
    }

    // Discord
    if (channel === "discord") {
      env.DISCORD_BOT_TOKEN = decryptSafe(config.discordBotToken);
      env.DISCORD_ALLOWED_GUILDS = config.discordAllowedGuilds || '';
      env.DISCORD_ALLOWED_USERS = config.discordAllowedUsers || '';
      env.DISCORD_ALLOWED_CHANNELS = config.discordAllowedChannels || '';
    }

    // Feishu / Lark
    if (channel === "feishu" || channel === "lark") {
      env.FEISHU_APP_ID = config.feishuAppId || '';
      env.FEISHU_APP_SECRET = decryptSafe(config.feishuAppSecret);
      env.FEISHU_REGION = config.feishuRegion || 'feishu';
      env.FEISHU_ALLOWED_USERS = config.feishuAllowedUsers || '';
      env.FEISHU_ALLOWED_CHATS = config.feishuAllowedChats || '';
      // Lark aliases
      env.LARK_APP_ID = env.FEISHU_APP_ID;
      env.LARK_APP_SECRET = env.FEISHU_APP_SECRET;
      env.LARK_ALLOWED_USERS = env.FEISHU_ALLOWED_USERS;
      env.LARK_ALLOWED_CHATS = env.FEISHU_ALLOWED_CHATS;
    }

    // QQ Bot
    if (channel === "qq_bot") {
      env.QQ_BOT_APP_ID = config.qqBotAppId || '';
      env.QQ_BOT_SECRET = decryptSafe(config.qqBotSecret);
      env.QQ_BOT_ALLOWED_USERS = config.qqBotAllowedUsers || '';
      env.QQ_BOT_ALLOWED_GUILDS = config.qqBotAllowedGuilds || '';
      env.QQ_BOT_ALLOWED_CHANNELS = config.qqBotAllowedChannels || '';

      // Hermes native mapping for QQ Bot
      env.QQ_APP_ID = config.qqBotAppId || '';
      env.QQ_CLIENT_SECRET = decryptSafe(config.qqBotSecret);
      if (config.gatewayAllowAllUsers === true) {
        env.QQ_ALLOW_ALL_USERS = 'true';
      } else {
        env.QQ_ALLOW_ALL_USERS = 'false';
        env.QQ_ALLOWED_USERS = config.qqBotAllowedUsers || '';
        env.QQ_GROUP_ALLOWED_USERS = config.qqBotAllowedGuilds || '';
      }
    }

    // WhatsApp
    if (channel === "whatsapp") {
      env.WHATSAPP_PHONE_NUMBER_ID = config.whatsappPhoneNumberId || '';
      env.WHATSAPP_ACCESS_TOKEN = decryptSafe(config.whatsappAccessToken);
      env.WHATSAPP_ALLOWED_USERS = config.whatsappAllowedUsers || '';
      env.WHATSAPP_ALLOWED_CHANNELS = config.whatsappAllowedChannels || '';
    }

    // Slack
    if (channel === "slack") {
      env.SLACK_BOT_TOKEN = decryptSafe(config.slackBotToken);
      env.SLACK_SIGNING_SECRET = decryptSafe(config.slackSigningSecret);
      env.SLACK_APP_TOKEN = decryptSafe(config.slackAppToken);
      env.SLACK_ALLOWED_USERS = config.slackAllowedUsers || '';
      env.SLACK_ALLOWED_CHANNELS = config.slackAllowedChannels || '';
    }

    // DingTalk
    if (channel === "dingtalk") {
      env.DINGTALK_APP_KEY = config.dingtalkAppKey || '';
      env.DINGTALK_APP_SECRET = decryptSafe(config.dingtalkAppSecret);
      env.DINGTALK_ROBOT_SECRET = decryptSafe(config.dingtalkRobotSecret);
      env.DINGTALK_ALLOWED_USERS = config.dingtalkAllowedUsers || '';
      env.DINGTALK_ALLOWED_CHATS = config.dingtalkAllowedChats || '';
    }

    // WeChat
    if (channel === "wechat") {
      env.WECHAT_APP_ID = config.wechatAppId || '';
      env.WECHAT_APP_SECRET = decryptSafe(config.wechatAppSecret);
      env.WECHAT_AGENT_ID = config.wechatAgentId || '';
    }

    // WeChat MP
    if (channel === "wechat_mp") {
      env.WECHAT_MP_APP_ID = config.wechatMpAppId || '';
      env.WECHAT_MP_APP_SECRET = decryptSafe(config.wechatMpAppSecret);
      env.WECHAT_MP_TOKEN = decryptSafe(config.wechatMpToken);
      env.WECHAT_MP_ENCODING_AES_KEY = decryptSafe(config.wechatMpEncodingAesKey);
      env.WECHAT_MP_ALLOWED_USERS = config.wechatMpAllowedUsers || '';
      env.WECHAT_MP_ALLOWED_CHATS = config.wechatMpAllowedChats || '';
    }

    // WeCom
    if (channel === "wecom") {
      env.WECOM_APP_ID = config.wecomAppId || '';
      env.WECOM_CORP_ID = config.wecomAppId || '';
      env.WECOM_APP_SECRET = decryptSafe(config.wecomAppSecret);
      env.WECOM_AGENT_ID = config.wecomAgentId || '';
      env.WECOM_TOKEN = decryptSafe(config.wecomToken);
      env.WECOM_ENCODING_AES_KEY = decryptSafe(config.wecomEncodingAesKey);
      env.WECOM_ALLOWED_USERS = config.wecomAllowedUsers || '';
      env.WECOM_ALLOWED_CHATS = config.wecomAllowedChats || '';
    }

    // Personal WeChat through Tencent iLink Bot API.
    if (channel === "weixin") {
      env.WEIXIN_ACCOUNT_ID = config.weixinAccountId || '';
      env.WEIXIN_TOKEN = decryptSafe(config.weixinToken);
      env.WEIXIN_BASE_URL = config.weixinBaseUrl || 'https://ilinkai.weixin.qq.com';
      env.WEIXIN_ALLOWED_USERS = config.weixinAllowedUsers || '';
      env.WEIXIN_ALLOWED_CHATS = config.weixinAllowedChats || '';
    }

    // Webhook
    if (channel === "webhook") {
      env.WEBHOOK_URL = config.webhookUrl || '';
      env.WEBHOOK_SECRET = decryptSafe(config.webhookSecret);
      env.WEBHOOK_ALLOWED_USERS = config.webhookAllowedUsers || '';
      env.WEBHOOK_ALLOWED_CHANNELS = config.webhookAllowedChannels || '';

      env.WEBHOOK_ENABLED = "true";
      env.WEBHOOK_HOST = "0.0.0.0";
      env.WEBHOOK_PORT = "8644";
    }
  }

  // Always inject API server environment for internal Chat Workspace if API key exists
  const internalApiKey = decryptSafe(config.apiServerKey || config.internalApiServerKey || config.internalApiKey || config.chatApiServerKey || config.API_SERVER_KEY || config.hermesApiKey || config.chatApiKey);
  if (internalApiKey) {
    env.API_SERVER_ENABLED = "true";
    env.API_SERVER_HOST = "0.0.0.0";
    env.API_SERVER_PORT = "8642";
    env.API_SERVER_KEY = internalApiKey;
  }

  // Skills
  env.SKILL_TAVILY_API_KEY = decryptSafe(config.skillTavilyApiKey);
  env.SKILL_SERPER_API_KEY = decryptSafe(config.skillSerperApiKey);
  env.SKILL_GITHUB_TOKEN = decryptSafe(config.skillGithubToken);

  env.AGENT_NAME = config.name || '';
  env.SYSTEM_PROMPT = config.agentPrompt || '';

  return env;
}
