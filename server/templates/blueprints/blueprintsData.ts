export interface IndustryBlueprint {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  version: string;
  recommended_skills: string[];
  recommended_channels: string[];
  referenced_workflow_template_ids: string[];
  system_context_preview: string;
  post_deploy_guide: string[];
  required_setup_items: string[];
  target_audience?: string;
  business_value?: string;
  readiness_checklist?: string[];
  next_actions?: any[];
  translations?: Partial<Record<"zh-CN" | "en", Record<string, unknown>>>;
  limitations?: string | string[];
}

export const INDUSTRY_BLUEPRINTS: IndustryBlueprint[] = [
  {
    id: "cross-border-ecom-operation",
    slug: "cross-border-ecom-operation",
    name: "独立站运营 Agent",
    description: "跨境独立站全场景智能体：包含各大竞争店价格变动监控、每日海外行业情报速递及订单快速履约实时异常诊断。",
    category: "ecommerce",
    version: "1.0.0",
    recommended_skills: ["browser", "file_system"],
    recommended_channels: ["feishu", "telegram"],
    referenced_workflow_template_ids: ["competitor-price-monitor", "daily-news-briefing", "ecommerce-order-alert"],
    system_context_preview: "你是一个专业的跨境独立站运营 Agent。你将协助运营团队深度观察并监控竞品价格动向、每日提炼收集跨境行业前沿速递与每日关键商业新闻。此外，由于我们接入了电商订单履约规则，你还会动态实时监控出单流转是否有异常订单。你习惯使用专业的跨境电商、DTC 品牌观察语调与飞书/Telegram 等渠道交付报告，你的目标是协助卖家快速决策、降低监控成本、大幅提升日常店面履约及分析效率。",
    required_setup_items: [
      "填写你的网站链接",
      "填写主要竞品链接",
      "运行第一份转化/竞品分析任务",
      "选择是否开启每周巡检",
      "选择是否接入飞书或 Telegram 接收报告"
    ],
    post_deploy_guide: [
      "填写你的专属独立站主页链接，初始化系统配置数据",
      "填写主要竞争店的商品细分页面或待观察商品 SKU URL 链接",
      "在任务中心触发‘竞品更新与降价预警分析’，启动第一轮智能大盘分析汇报",
      "设定计划排程任务(scheduled_jobs)，开启每周对独立站运营状态的健康度巡检",
      "根据需求在实例管理面板连接飞书应用或 Telegram 机器人接收通知推送"
    ],
    target_audience: "适合跨境独立站卖家、DTC品牌出海运营团队以及选品主管快速跟进市场动向。",
    business_value: "实现全天候竞品盯盘与多平台公开商品信息自动采集，大幅节省人工排查精力。基于大模型一键改写生成高转化英文商品文案，并可在识别到竞品异常调价时在飞书或群聊中自动推送风险预警。",
    readiness_checklist: [
      "准备用于文本翻译与重写的模型 API 密钥",
      "若需自动同步至店铺，需准备 Shopify 独立站管理后台的 API 读写密钥",
      "配置好用于接收通知的消息接收端点（如飞书 Webhook 或 Telegram Bot Token）"
    ],
    next_actions: [
      {
        action: "open_instance_settings",
        route: "/app/instances/:id/setup?section=shop-monitor",
        setupSection: "shop-monitor",
        label: "填写独立站 URL",
        description: "配置独立站环境变量与需要监控的竞品",
        isPrimary: true
      },
      {
        action: "upload_reference_files",
        label: "配置竞品监控范围",
        description: "在实例【文件管理器】中编辑或上传监控配置文件"
      },
      {
        action: "test_run",
        label: "阅读爆品分析指南",
        description: "查阅全站文档如何利用 Agent 跑批生成周报"
      }
    ],
    limitations: [
      "目前主要支持电商公开公开页面分析，若目标平台启用了极强的人机验证防御，部分页面可能需要配置专用代理。",
      "建议由人工对自动生成的商品文案进行最终合规复核后再正式发布上架。"
    ]
  },
  {
    id: "content-marketing-operation",
    slug: "content-marketing-operation",
    name: "内容运营 Agent",
    description: "新媒体内容矩阵先锋：辅助内容团队智能编写爆款选题文案，拆解热门短视频高分脚本，每日收集全球社交媒体爆点趋势。",
    category: "content",
    version: "1.0.0",
    recommended_skills: ["browser", "file_system"],
    recommended_channels: ["feishu", "telegram"],
    referenced_workflow_template_ids: ["xiaohongshu-topic-generator", "short-video-script-analyzer", "daily-news-briefing"],
    system_context_preview: "你是一个专家级的内容运营 Agent。擅长对小红书选题策划、社交平台爆款逻辑、短视频脚本进行多角度透视、分镜设计。你还将按时分析每日全网最新社交媒体趋势，剔除广告，并按需提炼、撰写富含金量的信息日历与内容大纲。你的最终目标是协助团队源源不断地产出吸睛的优质剧本选题与高转化文案。",
    required_setup_items: [
      "填写你的行业和目标用户",
      "生成第一批选题",
      "保存内容计划",
      "选择是否每周自动生成内容日历"
    ],
    post_deploy_guide: [
      "打开当前 Agent 的‘小红书选题生成’参数卡片，配置您的垂直行业细分与目标粉丝画像",
      "调用选题脚本，智能一键批量生成第一期包含封面关键词、大纲及心智钩子的选题计划",
      "使用文案分析能力分析一段热门短视频剧本，获得分镜以及文案优化指导，并将其写入文件管理系统的 content_plan 中",
      "设置定时跑批任务，每周一上午 09:00 自动为您合并最新的消费行业洞察形成本周推送计划",
      "根据需要接入飞书或 Telegram，便于您随手在移动端接收产出的灵感文档"
    ],
    target_audience: "适合小红书及短视频创作者、新媒体内容运营团队和MCN机构负责人高效产出爆款文案。",
    business_value: "支持上传热门推文、竞品分析或脚本大纲进行结构化提取，辅助内容团队批量扩展多维度选题。可根据受众痛点与反馈自动提供文案改写和优化大纲，解决日常选题枯竭和灵感瓶颈。",
    readiness_checklist: [
      "准备大语言模型 API 密钥，用于长文档学习与文案生成",
      "准备 1-3 篇行业内的优秀对标推文或视频脚本文件（支持 PDF 或 TXT 格式）作为学习样本",
      "设置好目标下发渠道的群聊机器人接收端（飞书 Webhook/企业微信）"
    ],
    next_actions: [
      {
        action: "open_instance_settings",
        label: "设置选题画像参数",
        description: "在实例配置项中配置垂直行业细分与粉丝属性",
        isPrimary: true
      },
      {
        action: "upload_reference_files",
        label: "上传选题分析样本",
        description: "通过【文件】标签页上传 PDF / TXT 爆款案例进行学习"
      },
      {
        action: "test_run",
        label: "查阅内容运营指南",
        description: "阅读小红书爆款复刻与大纲生成的高阶技巧"
      }
    ],
    limitations: [
      "由于社交媒体平台的开放发布接口限制，暂不支持全自动直接群发，主要提供精细的选题草稿与配图方向建议。",
      "自动生成的文案质量受输入的参考样本丰富度影响，建议人工进行润色与复核。"
    ]
  },
  {
    id: "team-collaboration",
    slug: "team-collaboration",
    name: "团队协同 Agent",
    description: "企业协同枢纽：自动精简长文档 PDF 并抽取提纲，智能识别多维群聊待办记录，每日按时打包分发项目周报进度。",
    category: "collaboration",
    version: "1.0.0",
    recommended_skills: ["file_read", "file_system"],
    recommended_channels: ["feishu"],
    referenced_workflow_template_ids: ["feishu-message-summary", "pdf-summary"],
    system_context_preview: "你是一个高效、细致的团队协同 Agent。擅长敏捷提取群聊核心议程、代办摘要、总结飞书等聊天上下文中错过的每日消息。你还可以帮助团队处理长文本、多文档 PDF 自动归类和多层重点结构化，从而把控项目的推进实效，保证所有人同步。你将使用极其简洁、结构清晰、极具行动力的语气呈现所有汇总周报。",
    required_setup_items: [
      "接入飞书",
      "选择需要总结的群或消息来源",
      "配置日报时间",
      "运行一次测试总结"
    ],
    post_deploy_guide: [
      "打开应用渠道连接，授权并打通您的飞书开放平台自建应用配置（传入 App ID 与 App Secret）",
      "配置需要监控及定时分析的飞书核心工作组群聊标识（Chat ID）或主要同步私聊来源",
      "配置定时任务触发频率（如每个工作日傍晚 18:00 准时打卡），生成群内关键事项 and 待办纪要",
      "通过文件管理器直接上传一份未处理的研究报告 PDF 附件，指令 Agent 进行极速智能图谱抽取，验证运行连通性"
    ],
    target_audience: "适合经常跨部门沟通的项目经理、日常事务繁杂的中小企业运营团队及研发小组高效整理待办。",
    business_value: "支持导入会议记录或文档快速归纳结构化待办与会议纪要。可将分散的项目进度日志自动整理并提炼为清晰的工作日报与周报，并通过群机器人监控日常高频提问，降低跨部门沟通成本。",
    readiness_checklist: [
      "准备好飞书开放平台自建应用的 App ID 与 App Secret 凭据",
      "需要具有对接收飞书群的群主或管理员权限，以添加群机器人并设置消息权限",
      "备好日常业务培训、标准 SOP 说明书或常见问题 Q&A 文本 PDF 文件"
    ],
    next_actions: [
      {
        action: "connect_channel",
        label: "对接飞书自建应用",
        description: "前往实例参数配置填写 App ID 与 Secret 凭证",
        isPrimary: true
      },
      {
        action: "upload_reference_files",
        label: "上传研究报告 PDF",
        description: "使用【文件】管理一键上传并开始提炼大纲与待办"
      },
      {
        action: "schedule_first_job",
        label: "管理定时协同周报",
        description: "在任务中心确认自动跑批与飞书通知的分发时间"
      }
    ],
    limitations: [
      "机器人自动响应和消息摘要的质量受到原始群聊消息完整度与讨论密集度的影响。",
      "部分高级接口和事件监听需要组织管理员在飞书开放平台完成应用审核与发布。"
    ]
  },
  {
    id: "ecommerce-operation",
    slug: "ecommerce-operation",
    name: "电商运营 Agent",
    description: "24h 电商守望者：支持主流平台的订单时效、延迟流转等电商履约红线报警监控，辅以竞品定价观察和定时行业要闻摘要。",
    category: "ecommerce",
    version: "1.0.0",
    recommended_skills: ["browser", "file_system"],
    recommended_channels: ["feishu", "telegram"],
    referenced_workflow_template_ids: ["ecommerce-order-alert", "competitor-price-monitor", "daily-news-briefing"],
    system_context_preview: "你是一个专业的电商运营 Agent。你擅长 24 小时全天候订单自动核实，针对大促期间的未发货订单异常延迟或流单告警提供秒级推送。你还能持续监控主流竞争品的价格变动、SKU 最新折扣以及热门品类的波动走势，让你在商战中占有绝对定价先机。你使用数据化、预警导向、客观精准的严密逻辑向飞书/Telegram 双向网关递交监控看板。",
    required_setup_items: [
      "填写店铺或产品信息",
      "填写竞品链接",
      "配置订单异常规则",
      "选择提醒渠道"
    ],
    post_deploy_guide: [
      "在环境参数项写入您当前运作的主力网店后台 API 入口或特定店铺订单汇总标识",
      "录入您核心需要盯盘的电商爆品对照组，并指定监控轮询间隔",
      "在异常处理器中，圈定订单超时未妥投、高危退款或退货流失的预警红线指标",
      "选定在触发警报时您第一顺位使用的消息接收媒介（支持飞书群应用及 Telegram 双向网关）"
    ],
    target_audience: "适合国内多平台电商卖家、店铺掌柜及仓储物流主管，用于自动化监控订单流转与异常红线。",
    business_value: "支持对多平台商铺库存、订单积压及发货延迟等红线指标进行自动巡检。可针对退款纠纷、高危订单及物流异常提供自动化过滤与及时推送，防止因超时未发货或派送停滞导致平台处罚。",
    readiness_checklist: [
      "准备好对应电商平台接口的授权凭证或管理后台 API 密钥",
      "设定您店铺核心物资的警戒安全库存值及物流配送时效阈值",
      "准备用于接收通知的飞书或 Telegram 机器人推送通道"
    ],
    next_actions: [
      {
        action: "open_instance_settings",
        route: "/app/instances/:id/setup?section=shop-monitor",
        label: "配置独立站监控",
        description: "在实例配置中写入监控店铺的主要商品元配置",
        isPrimary: true
      },
      {
        action: "schedule_first_job",
        label: "设定采购发货告警",
        description: "设定异常拦截阈值、发货超时与退款阻断阈值"
      },
      {
        action: "connect_channel",
        label: "绑定通知推送渠道",
        description: "前往实例渠道页绑定飞书/Telegram 触觉 Webhook"
      }
    ],
    limitations: [
      "部分国内电商后台的反爬和权限限制频繁更新，建议配合官方服务商接口使用，不建议在生产环境中进行强制网页解析。",
      "订单与退款拦截主要进行逻辑判定与风险提示，最终流转动作仍建议人工核准执行。"
    ]
  }
];
const BLUEPRINT_EN_TRANSLATIONS: Record<string, Record<string, unknown>> = {
  "cross-border-ecom-operation": {
    name: "Independent Store Operations Agent",
    description: "An operations Agent for cross-border stores, covering competitor price monitoring, industry intelligence, and order-fulfillment alerts.",
    system_context_preview: "You are a cross-border ecommerce operations Agent. Monitor competitor prices, summarize industry news, and flag delayed or abnormal order fulfillment with concise, actionable reports.",
    required_setup_items: ["Enter store information", "Add competitor product URLs", "Configure order alert rules", "Choose a notification channel"],
    post_deploy_guide: ["Open instance settings and enter the primary store URL and required environment values.", "Add competitor product URLs and confirm the monitoring interval.", "Configure the scheduled weekly competitor report.", "Connect Feishu or Telegram for order and price alerts."],
    target_audience: "For cross-border ecommerce sellers, DTC brand operators, and independent-store teams.",
    business_value: "Automates competitor monitoring, market briefings, and fulfillment exception alerts to reduce repetitive operational work.",
    readiness_checklist: ["Prepare the store URL and relevant API credentials.", "Prepare competitor product URLs.", "Prepare a Feishu or Telegram bot for notifications."],
    next_actions: [
      { action: "open_instance_settings", route: "/app/instances/:id/setup?section=shop-monitor", label: "Configure store integration", description: "Enter store settings and monitored products.", isPrimary: true },
      { action: "upload_reference_files", label: "Add competitor targets", description: "Upload or edit the competitor monitoring configuration." },
      { action: "schedule_first_job", label: "Schedule the first report", description: "Configure the recurring competitor and market report." }
    ],
    limitations: ["Some stores require official APIs or additional authentication.", "Review generated pricing and operational recommendations before applying them in production."]
  },
  "content-marketing-operation": {
    name: "Content Marketing Agent",
    description: "A content operations Agent for topic ideation, high-performing script analysis, and social trend monitoring.",
    system_context_preview: "You are a content marketing Agent. Analyze successful content patterns, generate topic plans and scripts, and present practical publishing recommendations.",
    required_setup_items: ["Define the content niche", "Describe the target audience", "Upload reference content", "Choose a notification channel"],
    post_deploy_guide: ["Configure the brand niche and target audience.", "Upload high-performing reference posts or scripts.", "Run the first topic-generation task.", "Connect a messaging channel for daily inspiration and results."],
    target_audience: "For content teams, independent creators, social media operators, and brand marketing teams.",
    business_value: "Reduces topic research and script-analysis time while producing reusable content structures and publishing ideas.",
    readiness_checklist: ["Prepare the target niche and audience profile.", "Prepare several reference posts or scripts.", "Confirm that the selected model credential is active."],
    next_actions: [
      { action: "open_instance_settings", label: "Configure content profile", description: "Set the niche, creator voice, and target audience.", isPrimary: true },
      { action: "upload_reference_files", label: "Upload reference content", description: "Add PDF, TXT, or script examples for analysis." },
      { action: "test_run", label: "Generate the first topic set", description: "Run the first content ideation task and inspect the results." }
    ],
    limitations: ["Generated content should be reviewed for brand, legal, and platform compliance.", "Trend data quality depends on available search sources and network access."]
  },
  "team-collaboration": {
    name: "Team Collaboration Agent",
    description: "A collaboration Agent for document summaries, group-chat action items, and scheduled team reports.",
    system_context_preview: "You are a team collaboration Agent. Summarize documents and conversations, extract owners and action items, and deliver concise scheduled reports.",
    required_setup_items: ["Configure the team messaging application", "Prepare a test group chat", "Prepare sample documents", "Set a report schedule"],
    post_deploy_guide: ["Configure and verify the Feishu application credentials.", "Add the bot to a test group and send a message.", "Upload a sample PDF or document for summarization.", "Configure the recurring team report schedule."],
    target_audience: "For project teams, operations groups, research teams, and distributed organizations.",
    business_value: "Converts scattered conversations and documents into structured summaries, action items, and recurring reports.",
    readiness_checklist: ["Prepare Feishu App ID and App Secret.", "Prepare a test chat and authorized users.", "Prepare a sample document."],
    next_actions: [
      { action: "configure_credentials", label: "Connect the Feishu application", description: "Enter and test the App ID and App Secret.", isPrimary: true },
      { action: "upload_pdf", label: "Upload a test document", description: "Upload a PDF and generate the first summary." },
      { action: "schedule_first_job", label: "Schedule the team report", description: "Configure the recurring summary and notification time." }
    ],
    limitations: ["The bot can only read conversations and files permitted by the messaging platform.", "Sensitive team material should follow the organization's data-handling policy."]
  },
  "ecommerce-operation": {
    name: "Ecommerce Operations Agent",
    description: "A 24/7 ecommerce Agent for order delays, refund risk, inventory thresholds, competitor pricing, and operational alerts.",
    system_context_preview: "You are an ecommerce operations Agent. Monitor orders, shipping delays, refund risk, inventory thresholds, and competitor pricing, then send clear operational alerts.",
    required_setup_items: ["Enter store or product information", "Add competitor URLs", "Configure order exception rules", "Choose an alert channel"],
    post_deploy_guide: ["Enter the store API endpoint or store identifier.", "Add key competitor products and the monitoring interval.", "Configure thresholds for delayed delivery, refunds, and other exceptions.", "Choose Feishu or Telegram for operational alerts."],
    target_audience: "For ecommerce sellers, store operators, warehouse teams, and logistics managers.",
    business_value: "Automates checks for inventory, order backlog, shipping delays, refunds, and logistics exceptions.",
    readiness_checklist: ["Prepare store API credentials or management API keys.", "Define inventory and delivery thresholds.", "Prepare a Feishu or Telegram notification bot."],
    next_actions: [
      { action: "open_instance_settings", route: "/app/instances/:id/setup?section=shop-monitor", label: "Configure store monitoring", description: "Enter store details and monitored products.", isPrimary: true },
      { action: "schedule_first_job", label: "Configure fulfillment alerts", description: "Set thresholds for shipping delays, refunds, and order exceptions." },
      { action: "connect_channel", label: "Connect the alert channel", description: "Connect Feishu or Telegram for notifications." }
    ],
    limitations: ["Some ecommerce systems require official APIs because anti-bot rules change frequently.", "Order blocking and refund decisions should remain subject to human approval."]
  }
};

for (const blueprint of INDUSTRY_BLUEPRINTS) {
  const english = BLUEPRINT_EN_TRANSLATIONS[blueprint.id];
  if (english) blueprint.translations = { ...(blueprint.translations || {}), en: english };
}
