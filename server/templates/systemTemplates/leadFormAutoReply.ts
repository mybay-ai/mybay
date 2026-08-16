import { WorkflowTemplate } from "../types";
import { REPLY_TONES } from "../options";

export const leadFormAutoReply: WorkflowTemplate = {
  id: "lead-form-auto-reply",
  slug: "lead-form-auto-reply",
  name: "客户表单自动回复",
  description: "实时接收用户在网站或营销页面提交表单的 Webhook，结合预设 prompt 与历史最佳邮件案例，即刻生成和发出高转化率的定制回复。",
  category: "sales",
  icon: "MailCheck",
  use_case: "B2B 销售线索留存、高净值客户咨询首次破冰、产品试用智能引导",
  tags: ["线索孵化", "即时回复", "营销自动化"],
  default_provider: "google",
  default_model: "gemini-2.5-flash",
  default_channel: "web",
  default_prompt: "你是一名顶尖的高科技 B2B 客户成功和销售拓客专家。当前收到一个新客户留存表单，包含客户留言、公司、预算等字段。请阅读客户的业务诉求，生成一封措辞得体、充满诚意和同理心的回复邮件。邮件中需：1. 亲切感谢其垂询并重述其痛点 2. 简要点出我们的方案如何精准解决该痛点 3. 顺畅且具有吸引力地邀请其预约 15 分钟 Demo 演示。请使用专业的中国标准商业电邮格式。",
  default_skills: ["custom_webhooks"],
  default_config: {
    LOW_MEMORY: "false"
  },
  required_inputs: [
    {
      key: "form_fields",
      label: "表单字段说明与键名",
      type: "textarea",
      description: "定义表单传递的数据键名和意义，引导 AI 准确匹配姓名、商业类型等字段",
      placeholder: "name: 姓名\ncompany: 公司名称\nneeds: 客户痛点疑惑\ncontact: 联络邮箱",
      required: true,
      defaultValue: "name: 提问者\ncompany: 公司机构\nmessage: 咨询意愿"
    },
    {
      key: "reply_tone",
      label: "回复语气",
      type: "select",
      options: REPLY_TONES,
      description: "AI 拟写邮件的风格温度",
      required: true,
      defaultValue: "professional"
    },
    {
      key: "notify_channel",
      label: "通知渠道",
      type: "select",
      description: "选择通知及回复发送的外部渠道",
      required: true,
      options: [
        { label: "飞书", value: "feishu" },
        { label: "Webhook 端", value: "webhook" },
        { label: "邮件", value: "email" }
      ],
      defaultValue: "email"
    },
    {
      key: "notify_target",
      label: "通知触达地址",
      type: "text",
      description: "填写该通知渠道对应的发送终点：如 Webhook URL、SMTP 邮箱地址等",
      placeholder: "例如: user@example.com 或 https://open.feishu.cn/open-apis/bot/v2/hook/...",
      required: true
    }
  ],
  supported_triggers: ["webhook"],
  default_trigger: {
    type: "webhook",
    interval: "表单提交即刻触发"
  },
  default_output: {
    type: "email_or_webhook",
    details: "生成全套回复电邮草稿，或者通过下游 Webhook 接口立即发送通知"
  },
  required_permissions: [
    {
      skill: "custom_webhooks",
      permission: "公开 Webhook 回调监听及向下游发包",
      risk: "medium",
      reason: "需要系统注册公开的 HTTP 服务端点接收表单数据，并在撰写完成后发送 API 回包"
    }
  ],
  setup_steps: [
    "1. 把表单系统 (如金数据、Typeform、HubSpot) 的 Webhook 转发地址绑定到此 Agent 实例生成的公网 Webhook 键名上",
    "2. 梳理你的产品价值、经典落地故事，作为 AI 撰写冷启动邮件的辅助指令背景材料",
    "3. 设定所需的回复语气（专业、热情、亲切）"
  ],
  initial_tasks: [
    { title: "注册 Webhook 监听宿主地址并进行测试连通", status: "queued" },
    { title: "初始化模板应答向量库与企业优势话术清单", status: "queued" }
  ],
  risk_level: "medium",
  is_system: true,
  is_active: true,
  sort_order: 5,
  readiness: "requires_webhook",
  target_audience: "B2B 销售总监、客户成功主管、出海独立站站长及在线咨询表单服务商。",
  readiness_checklist: [
    "准备一个常用的在线咨询表单系统（如 Typeform、金数据、HubSpot 等）的 Webhook 配置入口",
    "准备好公司的主营业务、经典成功案例、核心产品优势介绍（用作 AI 撰写的辅助背景）",
    "准备好一个发送正式邮件的 SMTP 服务器或用于中转发送的业务邮箱"
  ],
  post_deploy_guide: [
    "第一步：在配置页设定您的目标客群画像、主流咨询痛点解答以及产品标准对外 Q&A 手册。",
    "第二步：集成您的独立站或官方主页咨询表单 Webhook，确保当新客提交表单时，能在 10 秒内将数据分发给 Agent。",
    "第三步：测试自动回复。当有客户提交后，Agent 将基于 Q&A 手册深度匹配生成一份专属的业务建议，并自动以邮件或消息形式反馈客户。",
    "第四步：在客户跟踪仪表盘上，查看 Agent 的首响时长 and 新客线索跟进状态。"
  ],
  next_actions: [
    { label: "配置客户 Q&A 背景库", action: "update_knowledge_base" },
    { label: "绑定在线表单 Webhook", action: "configure_webhook_url" }
  ],
  limitations: [
    "如果新客户留下的表单信息非常简略且全为错字/乱码，系统会自动记录并发出异常警报，转由人工客服兜底，防止回复无意义内容"
  ],
  automation_result: "当客户在官网提交意向表单时，系统在 10 秒内对其需求完成语义解析，并自动调取企业知识库、拟写出一封真诚专业、直击痛点的定制电邮发送至客户，并同时通知销售跟进。",
  business_value: "首响应时间（FRT）由数小时缩短至 10 秒级，线索转化率和会面预约成功率提高 300% 以上，不漏掉任何一个深夜提交的高净值商机。"
};
