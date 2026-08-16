export interface ChannelGuide {
  channelId: string;
  label: string;
  guideTitle: string;
  description: string;
  internalRoute: string;
  externalUrl?: string;
  requiredFields: string[];
  setupSteps?: string[];
  difficulty: "easy" | "medium" | "advanced";
  supported: boolean;
  implementedInWizard: boolean;
}

export const channelGuides: Record<string, ChannelGuide> = {
  none: {
    channelId: "none",
    label: "Web 独立控制台",
    guideTitle: "Web 独立控制台配置指南",
    description: "无缝使用自带的安全前台网页对话框开展 AI 沙箱命令联调。不需要绑定任何第三方通信软件。",
    internalRoute: "/guides/messaging/dashboard",
    externalUrl: "/hermes/user-guide/messaging/dashboard",
    requiredFields: ["Basic Auth Username", "Basic Auth Password"],
    setupSteps: [
      "并在 DeployWizard 的'基础信息'页，设定您所需的网页访问账号与不少于 8 字节的访问密码",
      "部署就绪后，直接在浏览器端安全打开 '/agent/<path>' 子路径并提交凭据进入即可开展对话"
    ],
    difficulty: "easy",
    supported: true,
    implementedInWizard: true
  },
  telegram: {
    channelId: "telegram",
    label: "Telegram Bot",
    guideTitle: "Telegram 机器人配置指南",
    description: "通过官方 Bot API 进行个人专属指令沟通，支持消息播报、群聊过滤和群合规白名单限制。",
    internalRoute: "/guides/messaging/telegram",
    externalUrl: "/hermes/user-guide/messaging/telegram",
    requiredFields: ["Bot Token", "Allowed Users", "Allowed Chats"],
    setupSteps: [
      "向 Telegram @BotFather 申请创建一个全新的公开 Bot 获取 Bot Token",
      "通过输入 /my_id 向 @userinfobot 或其他查询机器人查询您的个人 Telegram 纯数字 ID，填入 Allowed Users",
      "将 Bot 拉进对应的群组，如果是超级群需额外提供群 ID（以 -100 开头），填入 Allowed Chats"
    ],
    difficulty: "easy",
    supported: true,
    implementedInWizard: true
  },
  discord: {
    channelId: "discord",
    label: "Discord 机器人",
    guideTitle: "Discord 机器人配置指南",
    description: "在 Discord Server (Guild) 和 Channel 频道中进行高吞吐事件播报，支持 Slash Commands 联动。",
    internalRoute: "/guides/messaging/discord",
    externalUrl: "/hermes/user-guide/messaging/discord",
    requiredFields: ["Bot Token", "Guild ID", "Channel ID"],
    setupSteps: [
      "在 Discord Developer Portal 中建立并注册一个新的 Discord Application，创建 Bot",
      "开启 Bot Settings 页面底部的 Message Content Intent 等核心特权",
      "在 Discord 客户端启用高级开发者模式，右键获取需要推送/互动的 Guild ID 与 Channel ID 列表并填入白名单"
    ],
    difficulty: "medium",
    supported: true,
    implementedInWizard: true
  },
  slack: {
    channelId: "slack",
    label: "Slack 协作应用",
    guideTitle: "Slack 配置指南",
    description: "将 Agent 接入 Slack 企业协同工作室，在特定频道 (Channel) 和 Thread 中提供快速响应与自动化控制。",
    internalRoute: "/guides/messaging/slack",
    externalUrl: "/hermes/user-guide/messaging/slack",
    requiredFields: ["Bot Token (xoxb-*)", "Allowed Users", "Allowed Channels"],
    setupSteps: [
      "打开 api.slack.com，创建一个以 Socket Mode 驱动的 Slack App",
      "在 OAuth & Permissions 中配置 app_mentions:read, chat:write 等 Bot 相关的 Scopes 权限",
      "安装此 App 至工作区并获取 xoxb- 开头的 Bot User OAuth Token 凭证填入配置"
    ],
    difficulty: "medium",
    supported: true,
    implementedInWizard: true
  },
  feishu: {
    channelId: "feishu",
    label: "飞书 (Feishu / Lark)",
    guideTitle: "飞书 / Lark 企业自建应用配置指南",
    description: "通过注册飞书自建机器人应用，实现在飞书单聊会话、企业群组内作为智能客服、排账助理即时交互。",
    internalRoute: "/guides/messaging/feishu",
    externalUrl: "/hermes/user-guide/messaging/feishu",
    requiredFields: ["App ID", "App Secret", "Allowed Users", "Allowed Chats"],
    setupSteps: [
      "登录飞书开放平台（open.feishu.cn），注册并发起一个全新的企业自建应用",
      "在应用功能中激活 机器人 功能，获取 App ID 及 App Secret 凭据",
      "前往事件订阅页和权限管理页，申请获取消息发送与私聊权限，将回调地址绑至麦贝对接端口服务"
    ],
    difficulty: "medium",
    supported: true,
    implementedInWizard: true
  },
  dingtalk: {
    channelId: "dingtalk",
    label: "钉钉 (DingTalk)",
    guideTitle: "钉钉智能对话机器人配置指南",
    description: "对接阿里巴巴旗下智能协作移动办公平台钉钉，搭载群聊天、单聊、或者是 H5 工作区智能大脑服务。",
    internalRoute: "/guides/messaging/dingtalk",
    externalUrl: "/hermes/user-guide/messaging/dingtalk",
    requiredFields: ["AppKey", "AppSecret", "Robot Secret (可选)", "Allowed Users"],
    setupSteps: [
      "进入钉钉开发者后台（open.dingtalk.com），建立智能群自建聊天机器人应用",
      "配置获取专用的 AppKey、AppSecret 鉴权参数",
      "如使用加签群推送，建议同步勾选或提供 SEC 机器人安全签名串用于签名鉴权校验"
    ],
    difficulty: "medium",
    supported: true,
    implementedInWizard: true
  },
  whatsapp: {
    channelId: "whatsapp",
    label: "WhatsApp (Meta)",
    guideTitle: "WhatsApp 企业级 API 对接指南",
    description: "对接全球海量用户沉淀的 WhatsApp 通讯。通过商业 Meta Graph API 完成高并发企业级双向即时播报。",
    internalRoute: "/guides/messaging/whatsapp",
    externalUrl: "/hermes/user-guide/messaging/whatsapp",
    requiredFields: ["Phone Number ID", "Access Token", "Allowed Users"],
    setupSteps: [
      "注册 Meta Developer 应用，开通 WhatsApp Cloud API 能力",
      "获取系统自动生成的商业测试/正式 Phone Number ID 号码",
      "生成一个永久或长期有效的 Meta Graph API 访问令牌 Client Access Token（以 EAAG 开头）并填入"
    ],
    difficulty: "advanced",
    supported: true,
    implementedInWizard: true
  },
  qq_bot: {
    channelId: "qq_bot",
    label: "QQ 机器人",
    guideTitle: "QQ 官方开放平台机器人配置指南",
    description: "注册腾讯官方 QQ 开放平台机器人，在多端、频道或小众群聊中开展极速命令自动回复 and 播报。",
    internalRoute: "/guides/messaging/qq",
    externalUrl: "/hermes/user-guide/messaging/qq",
    requiredFields: ["AppID", "Secret", "Allowed Guilds"],
    setupSteps: [
      "前往腾讯 QQ 开放平台（q.qq.com）申请认证成为开发者，创建指定群机器人应用",
      "获取该挂载机器人的唯一 AppID 以及配套的 Secret 校验串",
      "在频道与好友中通过 /openid 指令提取目标用户 OpenID 作为过滤条件填入白名单"
    ],
    difficulty: "medium",
    supported: true,
    implementedInWizard: true
  },
  wechat_mp: {
    channelId: "wechat_mp",
    label: "微信公众号",
    guideTitle: "微信公众号平台对接指南",
    description: "实现用户向微信公众号（服务号/订阅号）私信留言时，无缝由大模型流式解答或提取高级执行指令。",
    internalRoute: "/guides/messaging/wechat",
    externalUrl: "/hermes/user-guide/messaging/wechat",
    requiredFields: ["AppID", "AppSecret", "Allowed Users"],
    setupSteps: [
      "登录微信公众平台后台（mp.weixin.qq.com），获取公众号开发者凭据 AppID 与 AppSecret",
      "在公众号基本配置或开发配置中，通过填写麦贝实例外网反向代理 URL 与校验 Token 激活消息接口",
      "将关注用户的 OpenID（可在公众号管理后台或事件流抓包取得）添加到允许的用户名单中"
    ],
    difficulty: "medium",
    supported: true,
    implementedInWizard: true
  },
  wecom: {
    channelId: "wecom",
    label: "企业微信 (WeCom)",
    guideTitle: "企业微信核心 API 插件配置指南",
    description: "连接腾讯企业微信应用，定制自动客服回复助手、实现防刷安全控制以及系统白名单防骚扰机制。",
    internalRoute: "/guides/messaging/wecom",
    externalUrl: "/hermes/user-guide/messaging/wecom",
    requiredFields: ["CorpID/CorpSecret", "AgentID", "Allowed Users"],
    setupSteps: [
      "通过管理员登录企业微信后台（work.weixin.qq.com），查看企业基本信息的 CorpID",
      "在'应用管理'中创建全新的自建普通机器人应用，获取对应的 AgentID 以及专属的 AppSecret 串",
      "在自建应用的消息接收选项中配置外网回调路由并添加受信任的企业账号白名单"
    ],
    difficulty: "medium",
    supported: true,
    implementedInWizard: true
  },
  webhook: {
    channelId: "webhook",
    label: "自定义 Webhook",
    guideTitle: "通用 HTTP Webhook 对接指南",
    description: "系统将重要的触发事件、命令产出或者状态监控通过 POST 格式的规范 JSON 载荷秒级派发至指定后端接口。",
    internalRoute: "/guides/messaging/webhook",
    externalUrl: "/hermes/user-guide/messaging/webhook",
    requiredFields: ["Webhook URL", "Authentication Headers (可选)"],
    setupSteps: [
      "准备一个接收 Webhook 事件流报文的本地服务器或无服务器云函数 (FaaS, 如 AWS Lambda)",
      "在麦贝后台渠道设置页中，完整录入该 API 回调地址 (格式必须为 HTTPS / HTTP 完整链路)",
      "可选：根据您的接收接口格式，配置定制的头部 Signature 参数以防篡改漏洞"
    ],
    difficulty: "medium",
    supported: true,
    implementedInWizard: true
  },
  // Upcoming / Not Implemented in UI but mapped channels
  signal: {
    channelId: "signal",
    label: "Signal",
    guideTitle: "Signal 通信通道指南",
    description: "接入端到端隐私保护的 Signal 加密社交软件。借助 Signal CLI 守护程序连接全球安全通信节点。",
    internalRoute: "/guides/messaging/signal",
    externalUrl: "/hermes/user-guide/messaging/signal",
    requiredFields: ["Signal RPC Server URL", "Phone Number"],
    difficulty: "advanced",
    supported: false,
    implementedInWizard: false
  },
  sms: {
    channelId: "sms",
    label: "SMS 手机短信",
    guideTitle: "手机短信 SMS 对接指南",
    description: "借助 Twilio, Alibaba Cloud SMS 或 Infobip 实现手机极速下行短信播报与下发告警凭证。",
    internalRoute: "/guides/messaging/sms",
    externalUrl: "/hermes/user-guide/messaging/sms",
    requiredFields: ["Twilio Account SID", "Auth Token", "Origin Phone Number"],
    difficulty: "medium",
    supported: false,
    implementedInWizard: false
  },
  email: {
    channelId: "email",
    label: "SMTP 电子邮箱",
    guideTitle: "SMTP 电子邮箱群发配置指南",
    description: "当 Agent 检测到核心沙盒指标越界或自主决策通过后，将自动通过 SMTP 协议将通知推送给订阅者信箱。",
    internalRoute: "/guides/messaging/email",
    externalUrl: "/hermes/user-guide/messaging/email",
    requiredFields: ["SMTP Server Host", "Port (465/587)", "Sender Address", "Auth Password"],
    difficulty: "medium",
    supported: false,
    implementedInWizard: false
  },
  home_assistant: {
    channelId: "home_assistant",
    label: "Home Assistant",
    guideTitle: "Home Assistant 智能家居通道指南",
    description: "接入 Home Assistant 物联网大脑，实现 Agent 与智能设备（灯光、空调、自动化开关）双向控制联动。",
    internalRoute: "/guides/messaging/home_assistant",
    externalUrl: "/hermes/user-guide/messaging/home_assistant",
    requiredFields: ["HA Server Host", "Long-Lived Access Token"],
    difficulty: "advanced",
    supported: false,
    implementedInWizard: false
  },
  mattermost: {
    channelId: "mattermost",
    label: "Mattermost",
    guideTitle: "Mattermost 对接指南",
    description: "开源企业自建办公协同 Mattermost，借助 Personal Access Token 实现群内智能问答与播报助手机全覆盖。",
    internalRoute: "/guides/messaging/mattermost",
    externalUrl: "/hermes/user-guide/messaging/mattermost",
    requiredFields: ["Mattermost Host URL", "Bot Personal Access Token", "Team Name"],
    difficulty: "medium",
    supported: false,
    implementedInWizard: false
  },
  matrix: {
    channelId: "matrix",
    label: "Matrix (Element)",
    guideTitle: "Matrix 开源加密联邦中继指南",
    description: "对接 Matrix (Element) 联邦去中心化通信网络。配置 Homeserver 点位实现高强度隐私自主指令控制。",
    internalRoute: "/guides/messaging/matrix",
    externalUrl: "/hermes/user-guide/messaging/matrix",
    requiredFields: ["Homeserver URL", "User ID (@name:domain)", "Access Token"],
    difficulty: "advanced",
    supported: false,
    implementedInWizard: false
  },
  microsoft_teams: {
    channelId: "microsoft_teams",
    label: "Microsoft Teams",
    guideTitle: "Microsoft Teams 企业渠道对接指南",
    description: "借助 Microsoft Graph 或 Incoming Webhook 在 Teams 会话与企业团队 Channel 中激活 Agent 实时协作能力。",
    internalRoute: "/guides/messaging/microsoft_teams",
    externalUrl: "/hermes/user-guide/messaging/microsoft_teams",
    requiredFields: ["App Client ID", "Tenant ID", "Client Secret"],
    difficulty: "advanced",
    supported: false,
    implementedInWizard: false
  },
  line: {
    channelId: "line",
    label: "LINE",
    guideTitle: "LINE Messaging API 通道对接指南",
    description: "服务于日本、东南亚等广大 LINE 社交用户群体，建立 LINE Bot 并极速配置让群里有求必应。",
    internalRoute: "/guides/messaging/line",
    externalUrl: "/hermes/user-guide/messaging/line",
    requiredFields: ["Channel ID", "Channel Secret", "Channel Access Token"],
    difficulty: "medium",
    supported: false,
    implementedInWizard: false
  },
  ntfy: {
    channelId: "ntfy",
    label: "ntfy.sh 即时推送",
    guideTitle: "ntfy 即时消息订阅推送指南",
    description: "极速且不需后台账号验证的轻量级推送。每一通消息均可通过特定 Topic 毫无漏失地渲染到客户端。",
    internalRoute: "/guides/messaging/ntfy",
    externalUrl: "/hermes/user-guide/messaging/ntfy",
    requiredFields: ["ntfy Server Host (默认 ntfy.sh)", "Topic ID"],
    difficulty: "easy",
    supported: false,
    implementedInWizard: false
  },
  api: {
    channelId: "api",
    label: "独立 REST API 端点",
    guideTitle: "独立 API 对接开发与鉴权指南",
    description: "暴露内置的标准 API 端点（/api/v1/message），允许任何外部系统通过 Bearer Token 进行极简流式调用。",
    internalRoute: "/guides/messaging/api",
    externalUrl: "/hermes/user-guide/messaging/api",
    requiredFields: ["麦贝 API Secret Key"],
    difficulty: "medium",
    supported: false,
    implementedInWizard: false
  },
  weixin: {
    channelId: "weixin",
    label: "微信个人号 (微信小助手)",
    guideTitle: "微信个人客户端挂载连通指南",
    description: "通过 Web 微信底层协议或者底层注入驱动个人微信在单聊或亲友家庭群聊中充当智能大脑角色工作。",
    internalRoute: "/guides/messaging/weixin",
    externalUrl: "/hermes/user-guide/messaging/weixin",
    requiredFields: ["Client UUID", "Puppet Token / Scan QR"],
    difficulty: "advanced",
    supported: false,
    implementedInWizard: false
  }
};
