import type { ChannelSetupGuide } from "./channelSetupGuides.registry";

type GuideText = Pick<ChannelSetupGuide, "title" | "description" | "requiredItems"> & {
  estimatedTime?: string;
  steps: Array<{
    title: string;
    description: string;
    linkLabels?: string[];
    tip?: string;
  }>;
};

export const channelSetupGuidesEn: Record<string, GuideText> = {
  weixin: {
    title: "WeChat QR Binding Guide",
    description: "Bind a personal WeChat account directly by scanning a QR code. No Official Account or WeCom application is required.",
    estimatedTime: "1–2 minutes",
    requiredItems: ["An active personal WeChat account", "WeChat mobile app"],
    steps: [
      { title: "Generate a binding QR code", description: "Select Generate QR Code in channel settings. The code is issued by the WeChat iLink Bot service and expires shortly." },
      { title: "Scan with personal WeChat", description: "Use Scan in the WeChat mobile app and confirm the binding. Do not use an Official Account or WeCom client." },
      { title: "Wait for credentials to fill automatically", description: "The account ID, binding token, and service URL are filled after confirmation. The token is encrypted at rest and is never shown in instance details." },
      { title: "Deploy and verify the message loop", description: "Wait until channel health reports connected, send a message from the bound WeChat account, and confirm the Agent replies.", tip: "You can re-scan from instance settings without deleting the instance if the binding expires." }
    ]
  },
  feishu: {
    title: "Feishu / Lark Custom App Setup Guide",
    description: "Create a custom enterprise app, copy its App ID and App Secret, then test the connection before deployment.",
    estimatedTime: "5–10 minutes",
    requiredItems: ["Feishu Open Platform account", "App ID", "App Secret", "Allowed Users or Allowed Chats"],
    steps: [
      { title: "Open Feishu Open Platform", description: "Sign in with an enterprise or individual developer account.", linkLabels: ["Open Feishu Open Platform"] },
      { title: "Create a custom enterprise app", description: "Create a custom app and enter its name and description. This app connects the Agent to Feishu.", linkLabels: ["View app creation documentation"] },
      { title: "Copy the App ID and App Secret", description: "Copy both credentials from Credentials & Basic Info and enter them in the form." },
      { title: "Enable bot capability", description: "Open App Features > Bot in the app console and enable the bot." },
      { title: "Configure event subscription or WebSocket", description: "The default WebSocket mode usually needs no callback URL. Configure one under Event Subscriptions when using Webhook mode.", linkLabels: ["View event subscription guide"] },
      { title: "Configure permissions", description: "Grant the required direct-message and group @mention permissions, then publish an app version." },
      { title: "Test the connection and allowlist", description: "Return here, test the connection, and enter the allowed user or chat IDs.", tip: "You can temporarily allow all users while testing." }
    ]
  },
  telegram: {
    title: "Telegram Bot Setup Guide",
    description: "Create a bot with the official BotFather and obtain its API token.",
    estimatedTime: "2–3 minutes",
    requiredItems: ["Telegram account", "Bot API token"],
    steps: [
      { title: "Contact @BotFather", description: "Search for @BotFather in Telegram and start a private chat.", linkLabels: ["Open BotFather in Telegram"] },
      { title: "Create a bot", description: "Send /newbot, then choose a display name and a unique username ending in bot." },
      { title: "Copy the API token", description: "Copy the HTTP API access token returned by BotFather into the Bot Token field." },
      { title: "Configure the allowlist and test", description: "Add your Telegram user ID to Allowed Users, then test the connection.", tip: "You can obtain your user ID from @userinfobot." }
    ]
  },
  discord: {
    title: "Discord Bot Setup Guide",
    description: "Create an application in the Discord Developer Portal, enable its bot, and configure gateway intents.",
    estimatedTime: "5–8 minutes",
    requiredItems: ["Discord account", "Bot token", "Guild ID"],
    steps: [
      { title: "Create a Discord application", description: "Sign in to the Discord Developer Portal and select New Application.", linkLabels: ["Open Discord Developer Portal"] },
      { title: "Enable the bot and copy its token", description: "Open Bot in the sidebar and reset or copy the bot token." },
      { title: "Enable gateway intents", description: "Enable MESSAGE CONTENT INTENT so the Agent can read messages.", tip: "This is the most common Discord configuration issue." },
      { title: "Invite the bot to a server", description: "Use OAuth2 > URL Generator, select bot and the required permissions, then open the generated invitation URL." }
    ]
  },
  slack: {
    title: "Slack App Setup Guide",
    description: "Create a Slack app, configure OAuth scopes, and generate a Bot User OAuth Token.",
    estimatedTime: "8–12 minutes",
    requiredItems: ["Slack workspace admin access", "Bot token", "App token", "Signing secret"],
    steps: [
      { title: "Create a Slack app", description: "Open the Slack API console, select Create New App, and choose From scratch.", linkLabels: ["Open Slack API"] },
      { title: "Configure scopes", description: "Under OAuth & Permissions, add scopes such as app_mentions:read, chat:write, im:history, and groups:history." },
      { title: "Copy the token", description: "Install the app to the workspace and copy the Bot User OAuth Token into the form." },
      { title: "Enable Socket Mode (optional)", description: "If no public IP is available, enable Socket Mode and create an App Token for real-time communication." }
    ]
  },
  dingtalk: {
    title: "DingTalk Bot Setup Guide",
    description: "Create a DingTalk internal enterprise app and enable bot capability.",
    estimatedTime: "5–10 minutes",
    requiredItems: ["DingTalk Open Platform account", "AppKey", "AppSecret"],
    steps: [
      { title: "Open DingTalk Open Platform", description: "Sign in to the developer console and create an internal enterprise app.", linkLabels: ["Open DingTalk Open Platform"] },
      { title: "Copy app credentials", description: "Copy the AppKey and AppSecret into the form." },
      { title: "Enable bot capability", description: "Enable Bot under App Capabilities and configure its name and icon." }
    ]
  },
  whatsapp: {
    title: "WhatsApp Business API Setup Guide",
    description: "Create and configure a WhatsApp application in Meta for Developers.",
    estimatedTime: "15–20 minutes",
    requiredItems: ["Meta developer account", "Phone Number ID", "Access token"],
    steps: [
      { title: "Create a Meta app", description: "Create a Business-type app in Meta for Developers.", linkLabels: ["Open Meta for Developers"] },
      { title: "Add the WhatsApp product", description: "Add WhatsApp to the app and obtain a test number or connect a production number." },
      { title: "Copy the ID and token", description: "Copy the Phone Number ID and a permanent access token into the form." }
    ]
  },
  wechat: {
    title: "WeChat / WeCom Setup Guide",
    description: "Choose the appropriate setup path for a WeChat Official Account or WeCom.",
    requiredItems: ["Official Account AppID or WeCom Corp ID", "AppSecret"],
    steps: [
      { title: "Choose Official Account or WeCom", description: "Use mp.weixin.qq.com for an Official Account or work.weixin.qq.com for WeCom.", linkLabels: ["WeChat Official Accounts Platform", "WeCom Admin Console"] }
    ]
  },
  webhook: {
    title: "Webhook Setup Guide",
    description: "Configure the Agent to send event payloads to an external URL.",
    requiredItems: ["Destination URL", "Secret"],
    steps: [
      { title: "Prepare the receiver", description: "Make sure your server or service can receive and process POST requests." },
      { title: "Enter the URL and secret", description: "Enter the Webhook URL. When a secret is configured, the Agent includes a signature in the request headers." }
    ]
  }
};