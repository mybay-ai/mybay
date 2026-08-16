import { WorkflowTemplate } from "../types";
import { DAILY_RUN_TIMES } from "../options";

export const dailyNewsBriefing: WorkflowTemplate = {
  id: "daily-news-briefing",
  slug: "daily-news-briefing",
  name: "每日行业新闻摘要",
  description: "基于行业关键词与订阅主题，智能去重新闻，定时为您推送结构化智能行业简报。",
  category: "monitoring",
  icon: "Newspaper",
  use_case: "行业趋势跟踪、市场调研情报、前沿科技热点收集",
  tags: ["行业快报", "信息聚合", "定时推送"],
  default_provider: "google",
  default_model: "gemini-2.5-flash",
  default_channel: "web",
  default_prompt: "你是一名专业的行业分析专家。你的任务是分析通过网页浏览器获取的每日行业新闻，合并相同主题，剔除广告，并生成一份高含金量的每日行业简报。简报中对于每项重要新闻，必须指出：1. 核心事件 2. 行业影响 3. 数据指标（如果有）。请使用严谨专业、条理清晰的语调呈现。",
  default_skills: ["browser"],
  default_config: {
    LOW_MEMORY: "false"
  },
  required_inputs: [
    {
      key: "industry",
      label: "关注行业",
      type: "text",
      description: "告诉 Agent 你想长期追踪的行业或主题",
      placeholder: "例如：AI Agent、跨境电商、半导体、新能源",
      required: true,
      defaultValue: "AI Agent"
    },
    {
      key: "sources",
      label: "新闻来源",
      type: "url_list",
      description: "可填写你希望优先关注的网站、媒体、博客或公告页面；不填写则由 Agent 根据行业自动检索。",
      placeholder: "https://example.com/news\nhttps://tech.example.com",
      required: false
    },
    {
      key: "run_time",
      label: "每天运行时间",
      type: "select",
      description: "选择每天自动生成行业简报的时间",
      required: true,
      options: DAILY_RUN_TIMES,
      defaultValue: "09:00"
    },
    {
      key: "notify_channel",
      label: "通知渠道",
      type: "select",
      description: "选择简报生成后发送到哪里",
      required: true,
      options: [
        { label: "网页端", value: "web" },
        { label: "飞书", value: "feishu" },
        { label: "Webhook 端", value: "webhook" }
      ],
      defaultValue: "web"
    }
  ],
  supported_triggers: ["schedule"],
  default_trigger: {
    type: "schedule",
    cron: "0 9 * * *",
    interval: "每天定时"
  },
  default_output: {
    type: "feed_push",
    details: "自动发送结构化 News Brief 到控制面板及指定的通知通道中"
  },
  required_permissions: [
    {
      skill: "browser",
      permission: "外部网络网页抓取",
      risk: "low",
      reason: "需要联网访问新闻站点抓取最新的文字内容"
    }
  ],
  setup_steps: [
    "1. 配置你想关注的行业核心关键词，帮助 AI 过滤杂质新闻",
    "2. 填入特定的官方新闻网站、科技媒体 RSS 或博客 URL，使简报范围更精准",
    "3. 设置定时任务运行时间，每天准时获取晨报或晚报"
  ],
  initial_tasks: [
    { title: "扫描指定新闻源并解析 HTML 文档结构", status: "queued" },
    { title: "行业关键词过滤与重聚合语义去重", status: "queued" },
    { title: "提炼新闻摘要，格式化输出每日情报简报", status: "queued" }
  ],
  risk_level: "low",
  is_system: true,
  is_active: true,
  sort_order: 1,
  readiness: "llm_report_ready",
  target_audience: "需要保持对行业高度敏锐度的市场营销总监、产品经理、行研分析师、创始人及投资机构。",
  readiness_checklist: [
    "准备好您想追踪的 2-3 个核心行业关键词（如：跨境电商、大语言模型、新能源汽车）",
    "准备好你信任的行业媒体、官方公告或特定博客的 RSS/URL 链接列表（可选）",
    "选定您希望每天接收推送的渠道（如网页控制台、飞书群机器人、或者指定邮箱）"
  ],
  post_deploy_guide: [
    "第一步：配置您重点关注的行业热词或指定 RSS 新闻源 URLs，为 Agent 锚定精准的信息搜集视界。",
    "第二步：确认系统默认启用的 Google Search / API 搜索等信息检索技能处于启用状态。",
    "第三步：配置每日跑批时间（推荐设在每个工作日早晨 08:30），让 Agent 在上班前准时为你聚合生成高纯度的今日看点汇总。",
    "第四步：绑定消息渠道触觉，让早报自动推送至您的团队协作群组或指定邮箱。"
  ],
  next_actions: [
    { label: "立即跑批生成首份简报", action: "trigger_manual_run" },
    { label: "设置每日跑批定时时间", action: "set_cron_schedule" }
  ],
  limitations: [
    "智能去重依赖新闻正文的语义相似度算法，对于信息极少、语焉不详的短动态，建议配合手动合并",
    "新闻爬取深度为公开 DOM 文本，无法穿透必须登录或付费阅读的深度行业墙媒体"
  ],
  automation_result: "每天工作日，Agent 根据您设定的关键词检索、分析、清洗和提炼核心行业动态，生成智能行业简报，准时送达您的屏幕。",
  business_value: "每天节省 1-2 小时信息检索与噪音过滤时间，100% 捕获行业爆发性商机与竞品大动作，让决策层快人一步。"
};
