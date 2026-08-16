import { WorkflowTemplate } from "../types";
import { CHECK_FREQUENCIES } from "../options";

export const competitorPriceMonitor: WorkflowTemplate = {
  id: "competitor-price-monitor",
  slug: "competitor-price-monitor",
  name: "竞品价格监控 (沙箱模拟)",
  description: "基于沙箱模拟机制或对接电商 API 分析价格信息，提供智能偏离度分析与预警简报。",
  category: "commerce",
  icon: "TrendingDown",
  use_case: "电商定价决策、竞品促销跟踪、价格敏感度分析",
  tags: ["价格预警", "网页数据提取", "自动化比价"],
  default_provider: "google",
  default_model: "gemini-2.5-flash",
  default_channel: "web",
  default_prompt: "你是一名精通电商运营的比价决策智能体。你将获取目标竞品网页的价格和库存渲染文本。你的任务是提取商品名称、当前的准确标价、促销价、以及是否有货。如果相比上次提取（参考上下文）价格存在明显下调，请详细指出其折扣率，并根据设置 of 阈值发出变动警报报告。",
  default_skills: ["browser"],
  default_config: {
    LOW_MEMORY: "false"
  },
  required_inputs: [
    {
      key: "product_urls",
      label: "商品链接列表 (多行)",
      type: "url_list",
      description: "需要监控的竞争对手商品详情页或比价平台网页 URL 列表",
      placeholder: "https://competitor.com/item/101\nhttps://other-shop.com/product/555",
      required: true
    },
    {
      key: "check_frequency",
      label: "检查频率",
      type: "select",
      options: CHECK_FREQUENCIES,
      description: "执行价格检查的周期频率",
      required: true,
      defaultValue: "daily"
    },
    {
      key: "price_threshold",
      label: "价格变化提醒阈值 (%)",
      type: "number",
      description: "降价幅度达到多少百分比时触发变动告警 (例如输入 5 代表降幅达 5% 报警)",
      required: true,
      defaultValue: 5
    },
    {
      key: "notify_channel",
      label: "通知渠道",
      type: "select",
      options: [
        { label: "邮件", value: "email" },
        { label: "飞书", value: "feishu" },
        { label: "Webhook 端", value: "webhook" }
      ],
      description: "触发阈值降价告警时推送的渠道",
      required: true,
      defaultValue: "feishu"
    }
  ],
  supported_triggers: ["schedule"],
  default_trigger: {
    type: "schedule",
    cron: "0 10 * * *",
    interval: "每天 10:00 提取"
  },
  default_output: {
    type: "comparison_report",
    details: "当价格降幅满足过滤条件时，生成价格对比简报并推送"
  },
  required_permissions: [
    {
      skill: "browser",
      permission: "电商页面网络连接与公开 DOM 抓取",
      risk: "medium",
      reason: "需要定时向第三方商品页发起 GET 请求提取最新价格"
    }
  ],
  setup_steps: [
    "1. 复制多条监控商品的详细 URL 并填入列表中",
    "2. 设定降价百分比预警阈值，例如降价 10% 自动提示",
    "3. 绑定接收促销通知的邮件或飞书 Webhook 钩子"
  ],
  initial_tasks: [
    { title: "建立目标电商链接的首期基准价格抓取", status: "queued" },
    { title: "解析各网页的价格及库存关键 DOM 节点", status: "queued" }
  ],
  risk_level: "medium",
  is_system: true,
  is_active: true,
  sort_order: 2,
  readiness: "simulated",
  target_audience: "亚马逊/Shopify 电商卖家、品类采购主管、零售运营经理及渠道定价分析师。",
  readiness_checklist: [
    "准备好竞争对手商品详情页或比价平台网页的完整 URL 列表",
    "选定目标降价提醒比例（如相比基准价下降 10% 报警）",
    "准备好用于接收预警消息的飞书/企业微信机器人 Webhook 钩子或管理员邮箱"
  ],
  post_deploy_guide: [
    "第一步：配置并填写主要竞争对手独立站或第三方平台的核心商品详情 URLs。",
    "第二步：设定价格盯盘区间和预警阈值（例如：当竞品降价幅度超过 10% 时触发告警）。",
    "第三步：在控制台确认每周日零点自动执行竞品研究报告生成器。",
    "第四步：对接您的即时通讯工具渠道（飞书、钉钉或 Telegram），确保价格异常波动时秒级感知并通知采购/运营。"
  ],
  next_actions: [
    { label: "导入竞争对手商品链接", action: "input_urls" },
    { label: "测试首批基准价抓取", action: "run_initial_scraping" }
  ],
  limitations: [
    "对于添加了极强人机滑动验证、或必须登录且强制绑定特定地区手机号的闭环电商页面，需要单独配置代理或定制反爬绕过规则"
  ],
  automation_result: "系统运行仿真沙箱，模拟分析并推算参考商品价格，若波动达到阈值将自动生成沙箱模拟价格分析报告。",
  business_value: "实现对竞争对手价格变化的分钟级敏感探知，秒级对齐市场优势价格，保护自身毛利与销量，避免因价格滞后流失意向客群。"
};
