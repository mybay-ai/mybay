import { WorkflowTemplate } from "../types";
import { SUMMARY_PERIODS, OUTPUT_STYLES } from "../options";

export const feishuMessageSummary: WorkflowTemplate = {
  id: "feishu-message-summary",
  slug: "feishu-message-summary",
  name: "飞书消息自动总结 (需渠道授权)",
  description: "自动提炼和梳理群消息上下文，分类总结重要决策、跟进事项与分工待办（真实群聊读取需完成渠道授权）。",
  category: "team",
  icon: "MessageSquare",
  use_case: "群聊错峰进度同步、会议前置背景梳理、敏捷工作流自动同步",
  tags: ["团队协同", "社群运营", "异步总结"],
  default_provider: "google",
  default_model: "gemini-2.5-pro",
  default_channel: "feishu",
  default_prompt: "你是开发团队的极客和专业秘书。你需要分析当前飞书群聊中的海量群聊历史记录。请识别群内各个用户的讨论重点，自动抽离出：1. 已达成共识的核心决策（按话题分类） 2. 目前存在争议的或挂起的问题 3. 明确指派的跟进任务（标明 action item、负责人及 deadline）。请剔除日常寒暄词汇，让内容绝对精简干练。",
  default_skills: ["feishu"],
  default_config: {
    ENV_MODE: "server"
  },
  required_inputs: [
    {
      key: "feishu_channel",
      label: "飞书群或会话 ID",
      type: "text",
      description: "需要总结的飞书 Open Group ID 或特定会话标识",
      placeholder: "oc_xxxxxxxxxxxxxxxxxxxxxxxxxx",
      required: true
    },
    {
      key: "summary_period",
      label: "总结周期",
      type: "select",
      options: SUMMARY_PERIODS,
      description: "执行自动消息汇总并推送时间段",
      required: true,
      defaultValue: "daily"
    },
    {
      key: "output_style",
      label: "输出风格",
      type: "select",
      options: OUTPUT_STYLES,
      description: "总结的呈现排版样式",
      required: true,
      defaultValue: "bullet_points"
    }
  ],
  supported_triggers: ["message", "schedule"],
  default_trigger: {
    type: "schedule",
    cron: "0 18 * * *",
    interval: "每天 18:00 （下班前一小时）总结"
  },
  default_output: {
    type: "feishu_card",
    details: "生成结构化的飞书富文本卡片 (Message Card) 反向推送给该群聊中"
  },
  required_permissions: [
    {
      skill: "feishu",
      permission: "飞书群聊消息读取及富文本消息推送",
      risk: "medium",
      reason: "需要访问飞书开放平台 API 读取群消息以供 AI 分析，并具备群发送总结权限"
    }
  ],
  setup_steps: [
    "1. 在飞书开发者后台创建自建系统应用，并启用机器人能力",
    "2. 申请以下高级权限：获取群成员、读取群聊消息、发送消息",
    "3. 邀请机器人加入目标运营或工作群聊，并在此输入对应的会话 ID"
  ],
  initial_tasks: [
    { title: "建立飞书开放平台机器人回调与鉴权握手", status: "queued" },
    { title: "拉取飞书历史会话包，构建上下文清洗模型", status: "queued" }
  ],
  risk_level: "medium",
  is_system: true,
  is_active: true,
  sort_order: 3,
  readiness: "requires_channel_auth",
  target_audience: "需要管理大型社群、跨部门协作项目或追求高效异步办公的团队管理者与核心骨干。",
  readiness_checklist: [
    "已准备一个飞书企业自建应用，并获取其 App ID 与 App Secret 凭证",
    "已开通飞书机器人的读取群消息权限、获取群成员权限以及向群发送消息权限",
    "目标飞书群聊的 Open Group ID（可从飞书群设置或开发者工具中获取）"
  ],
  post_deploy_guide: [
    "第一步：前往实例管理，打开飞书企业应用配置界面，确保 App ID 与 App Secret 已经填写并验证通过。",
    "第二步：在飞书群聊中添加该机器人，发送任意包含长文章或会议链接的文本进行初步测试。",
    "第三步：在群聊中 @机器人 并回复“总结”，即可让其自动提取该段对话中的核心待办、纪要大纲并进行归档。",
    "第四步：开启定时跑批任务，每天下午 18:00 自动将一整天群聊内的碎片信息聚合生成一份精美的协同数字日报。"
  ],
  next_actions: [
    { label: "去飞书后台绑定 App ID", action: "configure_credentials" },
    { label: "拉取测试群消息验证", action: "run_test_job" }
  ],
  limitations: [
    "群聊消息最大单次拉取量受飞书 API 单次频率限制，建议每小时或每天定时总结，避免短时间内高频全量拉取",
    "无法分析飞书内置加密群、外部跨组织保密群的消息，需确保机器人具备目标群聊的访问和合规权限"
  ],
  automation_result: "在完成飞书渠道授权并且机器人加入目标群聊后，Agent 将自动聚合群聊内的讨论、决策及待办事项，生成日报卡片并自动推送至该群。",
  business_value: "消除海量无效刷群时间，团队异步同步效率提升 80%，让所有成员聚焦核心决策与分工，避免遗漏关键待办事项。"
};
