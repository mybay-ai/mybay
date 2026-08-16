import { WorkflowTemplate } from "../types";
import { VIDEO_PLATFORMS } from "../options";

export const shortVideoScriptAnalyzer: WorkflowTemplate = {
  id: "short-video-script-analyzer",
  slug: "short-video-script-analyzer",
  name: "短视频脚本分析",
  description: "分析短视频分镜头脚本文案，从黄金 3 秒完播、核心矛盾点、节奏留白与动作指引等多个专业维度拆解，提供详细的逐行精简与增效打磨建议。",
  category: "content",
  icon: "Video",
  use_case: "短视频爆款前置打磨、Douyin/Tiktok 脚本逐层审查、提升完播率与转化率",
  tags: ["视频营销", "脚本精打细磨", "完播率提升"],
  default_provider: "google",
  default_model: "gemini-2.5-pro",
  default_channel: "web",
  default_prompt: "你是一名孵化过千万粉丝账号的短视频商业化编神。你需要深度解析这篇短视频脚本的开头黄金 3 秒、故事冲突机制、台词精炼度、视觉及音效的配合效果。请以毒舌而极其精准的形式指出：1. 主播在第一句话中流失用户的安全隐患在哪里 2. 哪几处台词拖沓、毫无情绪推动，如何重写它们（附对比表） 3. 如何在特定秒数中，精准地安插视觉特写、变调音效或道具配合，以便大幅提升完播率 (Average Duration)。",
  default_skills: ["browser", "file_read"],
  default_config: {
    LOW_MEMORY: "false"
  },
  required_inputs: [
    {
      key: "script_text",
      label: "脚本文案内容",
      type: "textarea",
      description: "请将你的文字稿、配音旁白、或带景别动作的原始分镜脚本在这里贴出",
      placeholder: "可以是一大段纯录音文本或逐句带场景的粗剪草稿...",
      required: true,
      defaultValue: "【黄金三秒】你是不是也是这样：每天干活干到死，工资却从来没涨过？别再干这种体力活了......"
    },
    {
      key: "video_url",
      label: "竞争对手/参考视频链接",
      type: "url",
      description: "希望模仿的他人已经上线的成熟短视频 URL（可选）",
      placeholder: "https://v.douyin.com/abc123456",
      required: false
    },
    {
      key: "platform",
      label: "目标首发平台",
      type: "select",
      options: VIDEO_PLATFORMS,
      description: "不同平台用户的平均耐心与内容倾向有所差异，AI 将根据该平台定制敏感策略",
      required: true,
      defaultValue: "douyin"
    },
    {
      key: "analysis_goal",
      label: "分析目标与痛点",
      type: "textarea",
      description: "你对这台本最担心什么？例如：'前半部分太平淡，求黄金3秒勾人改法' 或 '软广带货痕迹太生硬，请自然重写它'",
      placeholder: "请指出你希望重点升级改造的部分...",
      required: true,
      defaultValue: "优化前3秒留存，精炼废话，设计合理的视觉动作指引与黄金转折口"
    }
  ],
  supported_triggers: ["manual"],
  default_trigger: {
    type: "manual"
  },
  default_output: {
    type: "script_audit_report",
    details: "生成精美的逐句精炼红蓝对比分析文及完播升级方案"
  },
  required_permissions: [
    {
      skill: "file_read",
      permission: "文件和分稿加载处理",
      risk: "low",
      reason: "需要读取脚本文本以供 AI 逐词逐句开展语义层级修剪"
    }
  ],
  setup_steps: [
    "1. 把你的视频脚本文本逐行贴入字段中",
    "2. 填入你预设的目标首发平台（抖音、TikTok等），算法会自动对齐对应平台的用户耐心周期特性",
    "3. 明确指出您所面临的核心痛点：例如广告太硬、内容冗杂、缺乏爽点冲突"
  ],
  initial_tasks: [
    { title: "对台词文笔和句式繁重程度进行多维数据指标测量", status: "queued" },
    { title: "开展分镜音效配乐戏剧点及痛点高光深度逆转改写", status: "queued" }
  ],
  risk_level: "low",
  is_system: true,
  is_active: true,
  sort_order: 8,
  readiness: "llm_report_ready",
  target_audience: "短视频 MCN 机构、个人 IP 创作者、带货主播、自媒体运营及视频广告策划。",
  readiness_checklist: [
    "准备待审查的视频脚本文字稿、台词配音旁白或者原始镜头脚本（支持 TXT、Docx、PDF 格式）",
    "收集 1-2 个您行业中获得百万点赞、希望模仿和超越的标杆参考视频链接"
  ],
  post_deploy_guide: [
    "第一步：打开当前 Agent 的短视频文案分析页面，设定您行业所属的垂直品类与短剧风格倾向。",
    "第二步：通过文件管理器上传历史高赞短视频文案文本或视频字幕脚本（支持 txt / docx / pdf 格式）。",
    "第三步：运行脚本分析指令，让 Agent 提取其吸睛分镜结构、心智锚点以及黄金 3 秒的抓人钩子。",
    "第四步：让 Agent 基于分析结果批量复刻生成新一期包含完整画面、旁白与视觉提示词的短视频脚本。"
  ],
  next_actions: [
    { label: "上传我的首份视频草稿", action: "upload_script" },
    { label: "选择参考风格开始分析", action: "analyze_now" }
  ],
  limitations: [
    "主要针对文本层面的完播逻辑、戏剧矛盾、情感钩子进行分析，无法直接决定视频实际拍摄时的打光、收音及演员演技等线下表现"
  ],
  automation_result: "上传脚本后，Agent 在 10 秒内输出详尽的‘红蓝改前改后对比表’，指出流失点、拖沓台词、并自动生成与之配合的视觉运镜、变调音效和场景道具脚本，大幅提升作品的完播潜力。",
  business_value: "让每一次拍摄都有千万爆款的逻辑支撑，新剧本完播率平均提升 35% 以上，减少废片率，实现内容资产的工业化高产。"
};
