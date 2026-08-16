import { WorkflowTemplate } from "../types";
import { CONTENT_STYLES } from "../options";

export const xiaohongshuTopicGenerator: WorkflowTemplate = {
  id: "xiaohongshu-topic-generator",
  slug: "xiaohongshu-topic-generator",
  name: "小红书选题生成",
  description: "分析当下时尚潮流、垂直赛道热议热词及高赞同类账号，深度洞察用户痛点，自动产出成系列具备爆款潜质的小红书大纲与文案选题建议。",
  category: "content",
  icon: "Sparkles",
  use_case: "新媒体内容矩阵策划、个人 IP 选题库搭建、小红书运营增效",
  tags: ["内容创作", "爆款营销", "选题策划"],
  default_provider: "google",
  default_model: "gemini-2.5-pro",
  default_channel: "web",
  default_prompt: "你是一名常驻在小红书的 MCN 爆款内容总监，深谙爆款逻辑和文案风格。基于用户给出的目标领域和人群，去搜寻其最新最热的细分吐槽点、情感痛点、焦虑词和向往场景。请输出 5 个选题，每个选题需要包含：1. 极具吸睛和情绪价值的 3 个备选封面标题（字数控制在 18 字以内，含 emoji） 2. 详细的视频内容切片/笔记主图逻辑 3. 正文第一段黄金勾人钩子设计 4. 全套爆款标签。",
  default_skills: ["browser"],
  default_config: {
    LOW_MEMORY: "false"
  },
  required_inputs: [
    {
      key: "niche",
      label: "账号垂直领域",
      type: "text",
      description: "如：'AI 极客成长指南', '留学生低卡做饭', '大厂裸辞回乡日常'",
      placeholder: "请输入你的账号领域...",
      required: true,
      defaultValue: "AI 职场提效"
    },
    {
      key: "target_audience",
      label: "目标受众 / 粉丝群体",
      type: "text",
      description: "如：'23-30岁职场打工人'、'考研焦虑大三学生'、'新手宝妈'",
      placeholder: "受众精准画象...",
      required: true,
      defaultValue: "面临重重职场压力的 20-30岁初入职场白领"
    },
    {
      key: "competitor_accounts",
      label: "对标/优秀同行竞品账号",
      type: "text",
      description: "输入你的优秀同行的名称、主页链接或核心大号名称，以便 AI 研究学习其爆款高光共鸣处（可选）",
      placeholder: "例如：小红书博主“极客小王”、“小明读物”",
      required: false
    },
    {
      key: "content_style",
      label: "内容整体风格",
      type: "select",
      options: CONTENT_STYLES,
      description: "笔记的表达情感倾向和视觉文风调性",
      required: true,
      defaultValue: "emotional"
    }
  ],
  supported_triggers: ["manual", "schedule"],
  default_trigger: {
    type: "manual"
  },
  default_output: {
    type: "topic_mindmap",
    details: "输出系统的成套选题思维大纲与笔记黄金排版草案"
  },
  required_permissions: [
    {
      skill: "browser",
      permission: "全网公开小红书爆款热门关键词及社媒高频词捕获",
      risk: "low",
      reason: "需要访问网络公共数据，获取当下特定受众讨论的最火段子和前沿痛点"
    }
  ],
  setup_steps: [
    "1. 写明你小红书目前的精确定向。定位越精准，越容易生成带爆款槽点的高质量选题",
    "2. 填入希望作为参考标杆的其他知名账号，使算法进行逆向风格模仿",
    "3. 立即触发，瞬间获得一整个月的选题排期表"
  ],
  initial_tasks: [
    { title: "自动生成小红书爆款选题与笔记文案策划报告", status: "queued" }
  ],
  risk_level: "low",
  is_system: true,
  is_active: true,
  sort_order: 7,
  readiness: "llm_report_ready",
  target_audience: "小红书博主、新媒体矩阵运营官、企业自媒体团队、个人 IP 塑造者以及商业文案策划。",
  readiness_checklist: [
    "梳理出您账号的主攻定位垂直细分领域及您的代表性受众画像特点",
    "准备 1-2 个您领域内近期高赞、深受粉丝喜爱的同行对标大号名称（可选）"
  ],
  post_deploy_guide: [
    "第一步：配置小红书账号的主攻定位、垂直细分领域以及目标粉丝的典型痛点需求。",
    "第二步：调用选题脚本，智能一键批量生成第一期包含封面文案、黄金钩子及核心爆点的内容计划表。",
    "第三步：挑选心仪的选题，让 Agent 深入撰写出排版精美、充满小红书特色表情（emoji）与痛点共鸣的草稿文案。",
    "第四步：自动输出相配的小红书标签与发布时间建议，助力内容轻松引流并爆单。"
  ],
  next_actions: [
    { label: "配置我的账号细分赛道", action: "configure_niche" },
    { label: "一键批量产出本月选题", action: "generate_topics" }
  ],
  limitations: [
    "生成的选题和排版旨在最大限度契合小红书用户的阅读心理和审美调性。但在最终发布前，创作者可微调并融入个人真实的语气和独家生活案例"
  ],
  automation_result: "系统将深度解析目标受众的细分痛点、吐槽点与焦虑向往场景，全自动一键批量产出高诱惑封面标题（带 emoji）、视频黄金切片结构、黄金前 3 秒吸引钩子及全套发布标签。",
  business_value: "彻底摆脱‘选题枯竭’焦虑，让内容策划时间缩减 90%，确保每条笔记都自带情绪价值和痛点共鸣，大幅提升笔记的曝光与互动转化率。"
};
