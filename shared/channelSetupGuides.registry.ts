
export type SetupFormData = any;

export interface SetupStep {
  title: string;
  description: string;
  links?: Array<{
    label: string;
    url: string;
    external: boolean;
  }>;
  fieldsToFill?: string[];
  tip?: string;
}

export interface ChannelSetupGuide {
  channelId: string;
  title: string;
  description: string;
  providerHomeUrl?: string;
  docsUrl?: string;
  difficulty: "easy" | "medium" | "advanced";
  estimatedTime?: string;
  requiredItems: string[];
  steps: SetupStep[];
}

export const channelSetupGuides: Record<string, ChannelSetupGuide> = {
  weixin: {
    channelId: "weixin",
    title: "个人微信扫码绑定向导",
    description: "无需微信公众号或企业微信应用，直接使用个人微信扫描二维码，把当前微信号绑定为 Agent 通讯渠道。",
    difficulty: "easy",
    estimatedTime: "1-2 分钟",
    requiredItems: ["可正常登录的个人微信", "微信手机客户端"],
    steps: [
      {
        title: "1. 生成绑定二维码",
        description: "在渠道配置区点击「生成二维码」。二维码由微信 iLink Bot 服务生成，短时间内有效。"
      },
      {
        title: "2. 使用个人微信扫码",
        description: "打开微信扫一扫，扫描页面二维码，并在手机端确认绑定。不要使用微信公众号或企业微信扫码。"
      },
      {
        title: "3. 等待凭据自动回填",
        description: "确认后页面会自动回填账号 ID、绑定 Token 和服务地址；Token 会加密保存，不会在实例详情中明文展示。",
        fieldsToFill: ["weixinAccountId", "weixinToken", "weixinBaseUrl"]
      },
      {
        title: "4. 部署并验证消息闭环",
        description: "部署完成后等待健康检查显示渠道已连接，再从绑定微信发送一条消息并确认 Agent 能正常回复。",
        tip: "如果二维码过期或绑定失效，可在实例设置中重新扫码，不需要删除实例。"
      }
    ]
  },
  feishu: {
    channelId: "feishu",
    title: "飞书 / Lark 企业自建应用配置向导",
    description: "按照步骤创建飞书企业自建应用，复制 App ID 和 App Secret，完成连接测试后即可部署。",
    providerHomeUrl: "https://open.feishu.cn",
    difficulty: "medium",
    estimatedTime: "5-10 分钟",
    requiredItems: ["飞书开放平台账号", "App ID", "App Secret", "Allowed Users 或 Allowed Chats"],
    steps: [
      {
        title: "1. 打开飞书开放平台",
        description: "进入飞书开放平台，并登录您的企业或个人开发者账号。",
        links: [{ label: "跳转飞书开放平台", url: "https://open.feishu.cn", external: true }]
      },
      {
        title: "2. 创建企业自建应用",
        description: "在开发者后台点击「创建自建应用」，填写应用名称和描述。这个应用将作为麦贝 Agent 的通信桥梁。",
        links: [{ label: "查看创建应用文档", url: "https://open.feishu.cn/document/home/index", external: true }]
      },
      {
        title: "3. 复制 App ID 和 App Secret",
        description: "在应用详情页面的「凭证与基础信息」中，复制 App ID 和 App Secret，并填写到左侧表单中。",
        fieldsToFill: ["feishuAppId", "feishuAppSecret"]
      },
      {
        title: "4. 开启机器人能力",
        description: "在应用控制台的「应用功能」-「机器人」中开启机器人开关。",
      },
      {
        title: "5. 配置事件订阅 / WebSocket",
        description: "若您使用的是麦贝默认的 WebSocket 模式，通常无需配置回调 URL。若使用 Webhook 模式，请在「事件订阅」中配置请求地址。",
        links: [{ label: "查看事件订阅指南", url: "https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure", external: true }]
      },
      {
        title: "6. 配置权限范围",
        description: "根据需要勾选「读取用户发给机器人的单聊消息」、「读取用户在群聊中 @ 机器人的消息」等权限，并发布应用版本。",
      },
      {
        title: "7. 测试连接与白名单",
        description: "返回此处点击「测试连接」。随后在左侧填写允许访问的用户 ID 或群聊 ID。",
        fieldsToFill: ["feishuAllowedUsers", "feishuAllowedChats"],
        tip: "测试模式下可临时启用「允许所有用户」以方便调试。"
      }
    ]
  },
  telegram: {
    channelId: "telegram",
    title: "Telegram Bot 配置向导",
    description: "通过 Telegram 官方 BotFather 创建机器人并获取 API Token。",
    providerHomeUrl: "https://t.me/BotFather",
    difficulty: "easy",
    estimatedTime: "2-3 分钟",
    requiredItems: ["Telegram 账号", "Bot API Token"],
    steps: [
      {
        title: "1. 联系 @BotFather",
        description: "在 Telegram 中搜索并私聊 @BotFather。",
        links: [{ label: "在 Telegram 中打开 BotFather", url: "https://t.me/BotFather", external: true }]
      },
      {
        title: "2. 创建新机器人",
        description: "发送 /newbot 指令，按照提示为您的机器人设置显示名称和唯一的用户名 (must end in 'bot')。",
      },
      {
        title: "3. 获取 API Token",
        description: "创建成功后，BotFather 会发送一段 HTTP API Access Token。复制它并填写到左侧 Bot Token 字段。",
        fieldsToFill: ["telegramBotToken"]
      },
      {
        title: "4. 填写白名单并测试",
        description: "由于 Telegram 任何人都能搜索到，建议务必填写您的 User ID (可以通过 @userinfobot 获取) 到 Allowed Users 中。",
        fieldsToFill: ["telegramAllowedUsers"],
        tip: "点击「测试连接」将尝试调用 getMe 接口验证 Token。"
      }
    ]
  },
  discord: {
    channelId: "discord",
    title: "Discord Bot 配置向导",
    description: "在 Discord 开发者门户创建应用，启用 Bot 功能并配置 Privileged Gateway Intents。",
    providerHomeUrl: "https://discord.com/developers/applications",
    difficulty: "medium",
    estimatedTime: "5-8 分钟",
    requiredItems: ["Discord 账号", "Bot Token", "Guild ID"],
    steps: [
      {
        title: "1. 创建 Discord Application",
        description: "登录 Discord Developer Portal 并点击「New Application」。",
        links: [{ label: "跳转开发者中心", url: "https://discord.com/developers/applications", external: true }]
      },
      {
        title: "2. 启用 Bot 并复制 Token",
        description: "在左侧菜单点击「Bot」，点击「Reset Token」或直接复制现有的 Bot Token。",
        fieldsToFill: ["discordBotToken"]
      },
      {
        title: "3. 启用 Gateway Intents",
        description: "在 Bot 页面向下滚动，开启「MESSAGE CONTENT INTENT」，否则 Agent 无法读取消息。",
        tip: "这是 Discord 最常见的配置错误，请务必开启。"
      },
      {
        title: "4. 邀请 Bot 到服务器",
        description: "在 OAuth2 -> URL Generator 中勾选 'bot' 和 'Administrator' 权限，生成链接并在浏览器打开以邀请到您的服务器。",
      }
    ]
  },
  slack: {
    channelId: "slack",
    title: "Slack App 配置向导",
    description: "创建 Slack App，配置权限 Scopes 并生成 Bot User OAuth Token。",
    providerHomeUrl: "https://api.slack.com/apps",
    difficulty: "medium",
    estimatedTime: "8-12 分钟",
    requiredItems: ["Slack Workspace 管理权限", "Bot Token", "App Token", "Signing Secret"],
    steps: [
      {
        title: "1. 创建 Slack App",
        description: "登录 Slack API 控制台，点击「Create New App」，选择「From scratch」。",
        links: [{ label: "跳转 Slack API", url: "https://api.slack.com/apps", external: true }]
      },
      {
        title: "2. 配置 Scopes",
        description: "在 OAuth & Permissions 下方的 Scopes 区域，添加 app_mentions:read, chat:write, im:history, groups:history 等权限。",
      },
      {
        title: "3. 获取 Token",
        description: "安装 App 到 Workspace 后，复制「Bot User OAuth Token」到左侧。",
        fieldsToFill: ["slackBotToken"]
      },
      {
        title: "4. 启用 Socket Mode (可选)",
        description: "如果没公网 IP，建议开启 Socket Mode 并获取 App Token 以实现双向实时通信。",
        fieldsToFill: ["slackAppToken"]
      }
    ]
  },
  dingtalk: {
    channelId: "dingtalk",
    title: "钉钉 / DingTalk 机器人配置向导",
    description: "创建钉钉企业自建应用，并开启机器人能力。",
    providerHomeUrl: "https://open.dingtalk.com",
    difficulty: "medium",
    estimatedTime: "5-10 分钟",
    requiredItems: ["钉钉开放平台账号", "AppKey", "AppSecret"],
    steps: [
      {
        title: "1. 进入钉钉开放平台",
        description: "登录钉钉开发者后台，创建企业内部应用。",
        links: [{ label: "跳转钉钉开放平台", url: "https://open.dingtalk.com", external: true }]
      },
      {
        title: "2. 获取应用凭证",
        description: "记录下 AppKey 和 AppSecret 并填入表单。",
        fieldsToFill: ["dingtalkAppKey", "dingtalkAppSecret"]
      },
      {
        title: "3. 开启机器人功能",
        description: "在「应用能力」中开启「机器人」，设置机器人名字和图标。",
      }
    ]
  },
  whatsapp: {
    channelId: "whatsapp",
    title: "WhatsApp Business API 配置向导",
    description: "在 Meta for Developers 中创建 WhatsApp 应用。",
    providerHomeUrl: "https://developers.facebook.com/apps/",
    difficulty: "advanced",
    estimatedTime: "15-20 分钟",
    requiredItems: ["Meta 开发者账号", "Phone Number ID", "Access Token"],
    steps: [
      {
        title: "1. 创建 Meta 应用",
        description: "在 Meta for Developers 创建 Business 类型的应用。",
        links: [{ label: "跳转 Meta 开发者中心", url: "https://developers.facebook.com/apps/", external: true }]
      },
      {
        title: "2. 设置 WhatsApp 产品",
        description: "在应用面板添加 WhatsApp 产品，获取测试手机号或绑定正式号码。",
      },
      {
        title: "3. 记录 ID 与 Token",
        description: "复制 Phone Number ID 和永久 Access Token。",
        fieldsToFill: ["whatsappPhoneNumberId", "whatsappAccessToken"]
      }
    ]
  },
  wechat: {
    channelId: "wechat",
    title: "微信 / WeCom 配置向导",
    description: "根据您是微信公众号还是企业微信，选择不同的配置路径。",
    providerHomeUrl: "https://mp.weixin.qq.com/",
    difficulty: "advanced",
    requiredItems: ["公众号 AppID / 企业微信 ID", "AppSecret"],
    steps: [
      {
        title: "1. 确认为公众号还是企业微信",
        description: "微信公众号请访问 mp.weixin.qq.com；企业微信请访问 work.weixin.qq.com。",
        links: [
          { label: "微信公众平台", url: "https://mp.weixin.qq.com/", external: true },
          { label: "企业微信管理后台", url: "https://work.weixin.qq.com/", external: true }
        ]
      }
    ]
  },
  webhook: {
    channelId: "webhook",
    title: "Webhook 配置向导",
    description: "配置麦贝向指定的外部 URL 发送事件负载。",
    difficulty: "easy",
    requiredItems: ["目标 URL", "Secret"],
    steps: [
      {
        title: "1. 准备接收端",
        description: "确保您的服务器或服务可以接收并处理 POST 请求。",
      },
      {
        title: "2. 填写 URL 和 Secret",
        description: "填入 Webhook URL。若配置了 Secret，麦贝会在 Header 中附带签名。",
        fieldsToFill: ["webhookUrl", "webhookSecret"]
      }
    ]
  }
};
