import { WorkflowTemplate } from "../types";
import { OUTPUT_LANGUAGES } from "../options";

export const pdfSummary: WorkflowTemplate = {
  id: "pdf-summary",
  slug: "pdf-summary",
  name: "PDF 文件总结",
  description: "上传大体积专业 PDF 论文、财报或产品说明书，通过底层向量库精准定位检索，秒级解答特定分析任务，免去阅读长文烦恼。",
  category: "document",
  icon: "FileText",
  use_case: "论文速读、招股书财报提炼、大型手册合规核对",
  tags: ["文档智能", "本地检索", "长文本降维"],
  default_provider: "google",
  default_model: "gemini-2.5-pro",
  default_channel: "web",
  default_prompt: "你是一名资深的商业咨询顾问和前沿科研翻译。请针对用户上传的 PDF 电子文档（路径：{{file}}）执行深度解析。你的总结目标是：{{summary_goal}}。输出语言应当是: {{output_language}}。首先提供一份不超过 300 字的快速摘要。随后，针对用户的“总结目标”中特别关注的疑问进行重点回应，并用中英文双语将相关核心章节中的支撑论据、图表结论逐一列出。对于不确定的信息，应当引用原文出处并指出可能存在的漏洞。",
  default_skills: ["file_read"],
  default_config: {
    LOW_MEMORY: "false"
  },
  required_inputs: [
    {
      key: "file",
      label: "PDF 文件",
      type: "file",
      accept: "application/pdf,.pdf",
      maxSizeMb: 20,
      description: "需要上传并由智能体分析的 PDF 本地文件（上限 20MB）",
      required: true
    },
    {
      key: "summary_goal",
      label: "总结目标",
      type: "textarea",
      description: "告诉 AI 你对这篇 PDF 感兴趣什么，例如：'提取该公司 2025 年净利润变动和核心风险防范章节' 或 '提炼这篇 AI 论文的核心创新贡献点'",
      placeholder: "请明确你的总结导向...",
      required: true,
      defaultValue: "总结文档的核心观点、主要技术指标、核心事实数据"
    },
    {
      key: "output_language",
      label: "输出语言",
      type: "select",
      options: OUTPUT_LANGUAGES,
      description: "分析报告的产出目标语言",
      required: true,
      defaultValue: "zh_CN"
    }
  ],
  supported_triggers: ["file_upload", "manual"],
  default_trigger: {
    type: "manual",
    interval: "立即开始"
  },
  default_output: {
    type: "markdown_report",
    details: "生成富文本格式的电子大纲阅读报告"
  },
  required_permissions: [
    {
      skill: "file_read",
      permission: "服务器临时目录读写与 PDF 文档加载",
      risk: "low",
      reason: "需要缓存用户上传的 PDF 并在沙盒中完成文字抽取与文档分割"
    }
  ],
  setup_steps: [
    "1. 上传你本地需要解析研究的学术 PDF、商业报告书",
    "2. 针对性写下你最关心的提问目标，避免大面积发散总结",
    "3. 运行触发，稍后可在交互面板获取全面提炼出的研究文章"
  ],
  initial_tasks: [
    { title: "文档预处理，切片并创建本地知识向量缓存", status: "queued" },
    { title: "提炼核心段落，完成针对性多维比对报告", status: "queued" }
  ],
  risk_level: "low",
  is_system: true,
  is_active: true,
  sort_order: 4,
  readiness: "requires_file_parser",
  target_audience: "需要阅读海量专业学术文献的科研人员、需要提炼密集行业报告的市场分析师、券商行研骨干及法务核对团队。",
  readiness_checklist: [
    "准备好需要精读的 PDF 格式学术论文、企业年报、行业调查或合规说明书文件（单文件建议 20MB 以内）",
    "梳理出本次精读您最想关注的核心议题（例如：核心风险章节、公司净利润增长因素等）"
  ],
  post_deploy_guide: [
    "第一步：进入实例面板，点击文件管理器，上传需要深度阅读的 PDF 格式研究报告或论文。",
    "第二步：点击运行 PDF 结构图谱析出指令，可在 5-10 秒内输出高保真内容提炼与章节大纲。",
    "第三步：在会话窗口中针对该 PDF 文件直接进行多轮细粒度追问，Agent 将自动结合文档上下文给出精准答复。",
    "第四步：可将一键提炼的 Markdown 精简内容直接复制或同步保存到团队协作文档中。"
  ],
  next_actions: [
    { label: "上传首个 PDF 文件", action: "upload_pdf" },
    { label: "快速提炼结构图谱", action: "run_pdf_summary" }
  ],
  limitations: [
    "对于完全未经过 OCR 处理的纯扫描版（全图无文字）PDF 文件，建议先利用文字识别工具处理后再行上传，以获得最佳精准度"
  ],
  automation_result: "上传大型 PDF 后，系统在 5 秒内全自动解析章节结构、提炼全局概要并精准定位和拆解您的特定核心提问。您可以通过对话窗口对该文件开展深入的追问和求证。",
  business_value: "单篇长论文/行业报告的阅读提炼时间由 2 小时缩短至 1 分钟，阅读吞吐量提升 15 倍以上，辅助研究人员快速搭建高质量知识网络。"
};
