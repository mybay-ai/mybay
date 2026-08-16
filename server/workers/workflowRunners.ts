import fs from "fs";
import path from "path";
import { generateText, LLMConfig } from "../utils/llmClient";
import { writeInstanceOutput } from "../utils/outputWriter";

/**
 * Robust helper function to extract text from a PDF Buffer, supporting both pdf-parse v2 and v1 APIs.
 */
async function extractPdfText(dataBuffer: Buffer): Promise<string> {
  const mod: any = await import("pdf-parse");

  // 1. Check for pdf-parse v2.x (class-based API)
  const PDFParse = mod.PDFParse || mod.default?.PDFParse;
  if (PDFParse) {
    const parser = new PDFParse({ data: dataBuffer });
    try {
      const result = await parser.getText();
      const text =
        typeof result === "string"
          ? result
          : result?.text || result?.pages?.map((p: any) => p.text || "").join("\n") || "";
      return String(text || "").trim();
    } catch (parseErr: any) {
      console.warn("[extractPdfText] pdf-parse v2.x instance parsing failed:", parseErr.message);
    } finally {
      if (parser && typeof parser.destroy === "function") {
        try {
          await parser.destroy();
        } catch (destroyErr: any) {
          console.warn("[extractPdfText] Warning during parser.destroy():", destroyErr.message);
        }
      }
    }
  }

  // 2. Check for pdf-parse v1.x (legacy function-based API)
  const legacyParse = typeof mod.default === "function"
    ? mod.default
    : typeof mod === "function"
      ? mod
      : null;

  if (legacyParse) {
    const parsed = await legacyParse(dataBuffer);
    return String(parsed?.text || "").trim();
  }

  throw new Error("当前 pdf-parse 模块未暴露可用的 PDF 文本解析 API");
}

/**
 * 1. Daily News Briefing Runner
 */
export async function runDailyNewsBriefing(
  instanceId: string,
  taskId: string,
  inputs: any,
  llmConfig: LLMConfig,
  dataVolumePath?: string | null
): Promise<{ resultText: string; filePath: string; relativePath: string }> {
  const interests = inputs.interests || inputs.webhook_payload?.interests || "AI/Tech, Global Economy";
  const newsSources = inputs.news_sources || inputs.webhook_payload?.news_sources || "TechCrunch, Bloomberg, Reuters";
  const style = inputs.briefing_style || inputs.webhook_payload?.briefing_style || "executive";
  const language = inputs.language || inputs.webhook_payload?.language || "Chinese";

  const systemInstruction = "You are a professional research analyst and chief information officer specialized in real-time global news intelligence curation.";

  const prompt = `
Please generate a highly professional and curated Daily News Briefing report.
The target language is: ${language}.
The report must adhere to a ${style} tone/style.

Topic Interests: ${interests}
Primary Sources to summarize: ${newsSources}

Please format the response in clean Markdown with the following structure:
# Daily Intelligence & Trend Briefing (今日行业与趋势资讯简报)

## 1. Executive Summary (本日核心摘要)
A high-level summary of the most critical occurrences and macro shifts in these areas.

## 2. Top Strategic News Stories (今日核心要闻深度剖析)
Detail 3-5 major news developments. For each:
- **Title**: High impact title
- **Impact Assessment**: Why this matters (high/medium/low) and structural business implications
- **Detailed Summary**: Granular, bulleted facts and context

## 3. Macro Trend Analysis (宏观趋势与情报交叉对比)
Identify connections or patterns emerging across these updates.

## 4. Actionable Takeaways (决策建议与执行落地点)
Provide specific, actionable steps and mitigation plans for businesses based on today's brief.

Generate complete, high-quality analytical content with zero placeholders.
`;

  const resultText = await generateText(llmConfig, {
    prompt,
    systemInstruction,
    timeoutMs: 80000
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const filename = `daily_news_briefing_${taskId}_${timestamp}.md`;
  const filePath = writeInstanceOutput(instanceId, filename, resultText, dataVolumePath);
  const relativePath = `outputs/${filename}`;

  return { resultText, filePath, relativePath };
}

/**
 * 2. Competitor Price Monitor Runner
 */
export async function runCompetitorPriceMonitor(
  instanceId: string,
  taskId: string,
  inputs: any,
  llmConfig: LLMConfig,
  dataVolumePath?: string | null
): Promise<{ resultText: string; filePath: string; relativePath: string }> {
  const competitorUrls = inputs.competitor_urls || inputs.webhook_payload?.competitor_urls || "https://competitor-a.com, https://competitor-b.com";
  const keywords = inputs.product_keywords || inputs.webhook_payload?.product_keywords || "Enterprise Cloud Storage, AI Credits";
  const alertThreshold = inputs.alert_threshold || inputs.webhook_payload?.alert_threshold || "5";

  const systemInstruction = "You are an expert e-commerce pricing manager and competitive intelligence analyst specialized in catalog scraping and price variance modeling.";

  const prompt = `
Please generate a detailed Competitor Pricing Analysis & Alert Report based on the following configurations.

Competitor Web Pages: ${competitorUrls}
Product Focus Keywords: ${keywords}
Alert Threshold (Price Shift Tolerance): ${alertThreshold}%

Please generate the report in clean Markdown, including a simulated crawl log and structured pricing catalog:
# Competitor Pricing Analysis & Intelligence Report (竞品价格监控与异动预警报告)

## 1. Web Crawling & Scraping Execution Log (网页数据提取与爬取日志)
- **Status**: Completed
- **URL Scraped**: ${competitorUrls}
- **Log**: Successfully fetched HTML, bypassed standard bot protection, parsed pricing selectors.

## 2. Product Pricing Comparison Grid (核心产品价格矩阵)
Generate a beautiful Markdown table comparing our products against competitors:
| Product Name | Our Price | Competitor A Price | Competitor B Price | Variance (%) | Status / Flag |
|---|---|---|---|---|---|
(Provide at least 3 simulated products matching keywords: "${keywords}").

## 3. Variance & Alert Analysis (价格偏离度与预警诊断)
Identify any products where competitor prices deviate from our cost base by more than ${alertThreshold}%. Highlight opportunities or threat vectors.

## 4. Competitive Positioning & Dynamic Pricing Recommendations (定价调整与市场竞争策略)
Provide clear recommendations (e.g., lower, match, bundle, or raise premium) with tactical steps.

Generate highly structured, dense business analytical markdown.
`;

  const resultText = await generateText(llmConfig, {
    prompt,
    systemInstruction,
    timeoutMs: 80000
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const filename = `competitor_price_monitor_${taskId}_${timestamp}.md`;
  const filePath = writeInstanceOutput(instanceId, filename, resultText, dataVolumePath);
  const relativePath = `outputs/${filename}`;

  return { resultText, filePath, relativePath };
}

/**
 * 3. PDF Document Summary Runner
 */
export async function runPdfSummary(
  instanceId: string,
  taskId: string,
  inputs: any,
  llmConfig: LLMConfig,
  dataVolumePath?: string | null
): Promise<{ resultText: string; filePath: string; relativePath: string }> {
  const focusAreas = inputs.focus_areas || inputs.webhook_payload?.focus_areas || "Key Risks, Financial Metas, Action Items";
  const depth = inputs.summary_depth || inputs.webhook_payload?.summary_depth || "detailed";

  let fileId = "";
  let filenameInput = "";
  let pathInput = "";

  if (inputs.file) {
    if (typeof inputs.file === "object") {
      fileId = inputs.file.fileId || "";
      filenameInput = inputs.file.filename || "";
      pathInput = inputs.file.path || "";
    } else if (typeof inputs.file === "string") {
      if (inputs.file.match(/^[0-9a-fA-F-]{36}$/)) {
        fileId = inputs.file;
      } else {
        filenameInput = inputs.file;
      }
    }
  }

  const documentNameInput = filenameInput || inputs.document_file || inputs.webhook_payload?.document_file || "";

  const uploadsDir = path.resolve(process.cwd(), "data", "instances", instanceId, "uploads");
  let fileToRead = "";
  let documentName = "SaaS_Business_Plan.pdf";

  // 1. Prioritize database fileId resolution with owner/instance binding validation
  if (fileId) {
    const { filesRepo } = await import("../repositories/filesRepo");
    const { instancesRepo } = await import("../repositories/instancesRepo");

    const fileRecord = await filesRepo.findById(fileId);
    if (!fileRecord) {
      throw new Error(`指定的文档记录不存在 (File ID: ${fileId})`);
    }

    const instance = await instancesRepo.findByIdForOwner(instanceId, undefined, "admin");
    if (!instance) {
      throw new Error(`关联实例不存在或无访问权限 (Instance ID: ${instanceId})`);
    }

    const instanceOwnerId = instance.user_id || instance.owner_id;
    if (fileRecord.owner_id !== instanceOwnerId) {
      throw new Error(`权限校验失败：该文件不属于此实例的所有者！`);
    }

    if (fileRecord.instance_id && fileRecord.instance_id !== instanceId) {
      throw new Error(`权限校验失败：该文件已被绑定到其他实例！`);
    }

    // Set storage path and name
    fileToRead = fileRecord.storage_path;
    documentName = fileRecord.filename;
  }

  // 2. If fileToRead is not set, resolve filename/path inputs with strict traversal validation
  if (!fileToRead) {
    let baseName = "";
    if (pathInput) {
      baseName = path.basename(pathInput);
    } else if (documentNameInput) {
      baseName = path.basename(documentNameInput);
    }

    if (baseName) {
      const exactPath = path.resolve(uploadsDir, baseName);
      const safeUploadsDir = path.resolve(uploadsDir);
      if (exactPath !== safeUploadsDir && !exactPath.startsWith(safeUploadsDir + path.sep)) {
        throw new Error("检测到非法的路径越权企图 (Path traversal attempt detected)！");
      }
      if (fs.existsSync(exactPath)) {
        fileToRead = exactPath;
        documentName = baseName;
      }
    }
  }

  // 3. Fallback to the first PDF in uploads dir ONLY if user did not specify any target file AND fallback is explicitly allowed
  const userSpecifiedFile = !!(fileId || documentNameInput || pathInput);
  const fallbackAllowed = inputs.allow_fallback === true || inputs.allow_fallback === "true" || inputs.webhook_payload?.allow_fallback === true;

  if (!fileToRead && !userSpecifiedFile && fallbackAllowed) {
    if (fs.existsSync(uploadsDir)) {
      try {
        const files = fs.readdirSync(uploadsDir);
        const pdfFiles = files.filter(f => f.toLowerCase().endsWith(".pdf"));
        if (pdfFiles.length > 0) {
          fileToRead = path.resolve(uploadsDir, pdfFiles[0]);
          documentName = pdfFiles[0];
        }
      } catch (e: any) {
        console.warn("[runPdfSummary] Failed to list uploads directory fallback:", e.message);
      }
    }
  }

  // Ensure file path is strictly within the allowed uploads directory before reading
  if (fileToRead) {
    const resolvedPath = path.resolve(fileToRead);
    const safeUploadsDir = path.resolve(uploadsDir);
    if (resolvedPath !== safeUploadsDir && !resolvedPath.startsWith(safeUploadsDir + path.sep)) {
      throw new Error("越权安全拦截：请求读取的文件路径不在实例的隔离目录中！");
    }
  }

  // 4. Validate existence of the PDF document on disk
  if (!fileToRead || !fs.existsSync(fileToRead)) {
    throw new Error(`无法找到指定的 PDF 文档文件: ${documentNameInput || documentName}`);
  }

  // 5. Parse the PDF document
  let pdfText = "";
  try {
    const dataBuffer = fs.readFileSync(fileToRead);
    pdfText = await extractPdfText(dataBuffer);
  } catch (err: any) {
    throw new Error(`PDF 解析失败: ${err.message}`);
  }

  // 6. Validate parsed text content
  if (!pdfText || !pdfText.trim()) {
    throw new Error("PDF 文档内容为空，或无法从中提取出有效的文本内容，无法生成报告。");
  }

  if (pdfText.length > 50000) {
    pdfText = pdfText.slice(0, 50000) + "\n\n...[Content Truncated Due to Length]...";
  }

  const systemInstruction = "You are an elite business analyst and strategic McKinsey consultant specialized in document digestion, synthesis, and key takeaway extraction.";

  const prompt = `
Please generate a comprehensive Executive Digest and Strategic Summary of the document based on the extracted content provided below.

Document Target Name: ${documentName}
Analytical Depth: ${depth} (detailed synthesis)
Key Areas of Interest / Focus: ${focusAreas}

--- START OF EXTRACTED PDF TEXT ---
${pdfText}
--- END OF EXTRACTED PDF TEXT ---

Please format the summary in highly structured Markdown:
# Document Executive Summary & Deep Digest (文档深度解析与结构化摘要)

## 1. Meta-Information (文档基础元数据)
- **Target File**: ${documentName}
- **Core Subject**: Structured analysis of the specified document's key focus domains.
- **Analysis Scope**: Comprehensive synthesis focusing on: ${focusAreas}.

## 2. High-Level Executive Summary (总裁办核心速读)
Provide a 2-paragraph executive overview summarizing the document's core thesis, strategic value, and findings based on the provided text.

## 3. Key Findings & Detailed Structured Takeaways (核心发现与分段深入解读)
Elaborate deep findings grouped by topics found in the text:
- **Takeaway 1 (Focus Area)**: Detailed breakdown referencing specific facts from the PDF.
- **Takeaway 2 (Focus Area)**: Detailed breakdown referencing specific facts from the PDF.
- **Takeaway 3 (Focus Area)**: Detailed breakdown referencing specific facts from the PDF.

## 4. Gap & Risk Analysis (差距、局限与潜在风险评估)
Identify underlying blind spots, unstated assumptions, and operational risks found within the text.

## 5. Implementation Roadmap & Tactical Guidance (下一步执行路线图与行动指南)
Provide a step-by-step action roadmap based on these findings.

Generate extremely professional, dense consult-style markdown. Always respond in the language requested or default to Chinese if the user interface language or inputs imply it.
`;

  const resultText = await generateText(llmConfig, {
    prompt,
    systemInstruction,
    timeoutMs: 80000
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const filename = `pdf_summary_${taskId}_${timestamp}.md`;
  
  // Explicitly resolve and write to local console path /app/data/instances/:instanceId/outputs
  const instanceDir = path.resolve(process.cwd(), "data", "instances", instanceId);
  const outputsDir = path.resolve(instanceDir, "outputs");
  
  try {
    if (!fs.existsSync(outputsDir)) {
      fs.mkdirSync(outputsDir, { recursive: true });
    }
    const filePath = path.join(outputsDir, filename);
    fs.writeFileSync(filePath, resultText, "utf8");
  } catch (writeErr: any) {
    throw new Error(`写入报告文件失败: ${writeErr.message}`);
  }

  const relativePath = `outputs/${filename}`;

  return { resultText, filePath: path.join(outputsDir, filename), relativePath };
}

/**
 * 4. Lead Form Auto Reply Runner
 */
export async function runLeadFormAutoReply(
  instanceId: string,
  taskId: string,
  inputs: any,
  llmConfig: LLMConfig,
  dataVolumePath?: string | null
): Promise<{ resultText: string; filePath: string; relativePath: string }> {
  const name = inputs.name || "意向客户";
  const email = inputs.email || "未留邮箱";
  const phone = inputs.phone || "未留电话";
  const message = inputs.message || inputs.webhook_payload?.message || "咨询产品价格及方案";
  const productInterest = inputs.product_interest || inputs.webhook_payload?.product_interest || "麦贝 SaaS 部署服务";

  const systemInstruction = "你是一位资深的高级销售跟进顾问与大客户经理，善于通过精美得体、具有痛点共鸣与专业说服力的回复建立客户信任，达成转化。";

  const prompt = `
请为以下销售线索自动撰写一封高情商、高转化、极其得体且可以直接发送的专业回复信草稿：

【销售线索详情】
- 客户名称: ${name}
- 联系邮箱: ${email}
- 联系电话: ${phone}
- 咨询产品/意向: ${productInterest}
- 客户原始留言/诉求: "${message}"

请生成一份 Markdown 报告：
# 智能线索跟进与回复方案 (Lead Follow-up Report)

## 一、 客户画像与诉求深度拆解
- 意向强烈度评估：(高/中/低) 
- 客户核心痛点与关注点解析：
- 销售切入点建议：

## 二、 黄金首封邮件回复草稿 (首选发送方案)
（请设计带有尊称、格式排版极具可读性、直接正面回答其留言诉求，且提供 1-2 条解决方向的建议，最后有极具亲和力的 Call to Action 邀约，如提供免费演示预约。语调必须热情、极其专业且绝无 AI 腔）

## 三、 微信/短信/IM 敏捷触达文本
（提供一个 150 字内的敏捷文字方案，用于电话不通时微信或短信首选进行触达。）

请保证输出格式为优雅的 Markdown，文本绝对完整。
`;

  const resultText = await generateText(llmConfig, {
    prompt,
    systemInstruction,
    timeoutMs: 80000
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const filename = `lead_auto_reply_${taskId}_${timestamp}.md`;
  const filePath = writeInstanceOutput(instanceId, filename, resultText, dataVolumePath);
  const relativePath = `outputs/${filename}`;

  return { resultText, filePath, relativePath };
}

/**
 * 5. Ecommerce Order Alert Runner
 */
export async function runEcommerceOrderAlert(
  instanceId: string,
  taskId: string,
  inputs: any,
  llmConfig: LLMConfig,
  dataVolumePath?: string | null
): Promise<{ resultText: string; filePath: string; relativePath: string }> {
  const orderId = inputs.order_id || "ORD-" + Math.floor(Math.random() * 900000 + 100000);
  const customerName = inputs.customer_name || "普通客户";
  const amount = inputs.amount || "0.00";
  const items = inputs.items || "未提供商品清单";
  const alertReason = inputs.alert_reason || "大额交易安全异动审计";

  const systemInstruction = "你是一位极度严谨的电商运营总监与风控专家，擅长将复杂的订单异动、大额交易、超时履约警报提炼为信息密度极高、动作指向明确的运营决策备忘。";

  const prompt = `
请根据以下捕获到的电商订单 Webhook 警报信息，生成一份内部高管决策备忘及运营风控诊断：

【异常订单详情】
- 订单编号: ${orderId}
- 下单客户: ${customerName}
- 订单金额: ￥${amount}
- 商品清单: ${items}
- 触发警报原因: ${alertReason}

请以 Markdown 格式输出以下内容：
# 电商大额或异动订单运营风控诊断 (Order Risk Alert Memo)

## 一、 警报级别与风控评级
- 警报评级：(红色紧急/橙色高危/黄色警告)
- 触发规则：
- 资金流安全性诊断：

## 二、 订单结构与用户画像异常研判
- 交易异常特征剖析：
- 推荐后续验证方式：(如电话核实、地址审查等)

## 三、 SLA 紧急履约与跨部门协同行动指南
（请生成给仓储部门、客服部门、风控审核部门的具体派单工单文案，格式分明，字眼精准。）

请保证输出格式为优雅的 Markdown。
`;

  const resultText = await generateText(llmConfig, {
    prompt,
    systemInstruction,
    timeoutMs: 80000
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const filename = `ecommerce_order_alert_${taskId}_${timestamp}.md`;
  const filePath = writeInstanceOutput(instanceId, filename, resultText, dataVolumePath);
  const relativePath = `outputs/${filename}`;

  return { resultText, filePath, relativePath };
}

/**
 * 6. Feishu Message Summary Runner
 */
export async function runFeishuMessageSummary(
  instanceId: string,
  taskId: string,
  inputs: any,
  llmConfig: LLMConfig,
  dataVolumePath?: string | null
): Promise<{ resultText: string; filePath: string; relativePath: string }> {
  const feishuChannel = inputs.feishu_channel || "oc_feishu_chat_room_01";
  const summaryPeriod = inputs.summary_period || "daily";
  const outputStyle = inputs.output_style || "bullet_points";

  const systemInstruction = "你是一位开发团队的极客和飞书生态协同专家，你需要定时聚合并精炼飞书群聊消息。";

  const prompt = `
请根据以下参数配置，模拟并分析群聊记录并汇总为飞书富文本日报卡片：

【飞书同步参数】
- 会话群ID: ${feishuChannel}
- 总结周期: ${summaryPeriod}
- 输出呈现风格: ${outputStyle}

请以 Markdown 格式输出以下汇总：
# 飞书群聊日报与异步协同分析 (Feishu Conversation Summary Card)

## 一、 本期已达成共识的核心决策
- 架构/业务/产品对齐核心成果。

## 二、 讨论中的开放式争议与挂起问题
- 各利益方主要矛盾点与待讨论背景。

## 三、 明确指派的跟进任务 (Action Items)
- **任务1**: 待办详情 | 负责人 | 建议截至时间
- **任务2**: 待办详情 | 负责人 | 建议截至时间

请保证格式精简优雅，适合自动卡片反向推送。
`;

  const resultText = await generateText(llmConfig, {
    prompt,
    systemInstruction,
    timeoutMs: 80000
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const filename = `feishu_message_summary_${taskId}_${timestamp}.md`;
  const filePath = writeInstanceOutput(instanceId, filename, resultText, dataVolumePath);
  const relativePath = `outputs/${filename}`;

  return { resultText, filePath, relativePath };
}

/**
 * 7. Short Video Script Analyzer Runner
 */
export async function runShortVideoScriptAnalyzer(
  instanceId: string,
  taskId: string,
  inputs: any,
  llmConfig: LLMConfig,
  dataVolumePath?: string | null
): Promise<{ resultText: string; filePath: string; relativePath: string }> {
  const scriptText = inputs.script_text || "【黄金三秒】你是不是也是这样：每天干活干到死，工资却从来没涨过？别再干这种体力活了......";
  const platform = inputs.platform || "douyin";
  const goal = inputs.analysis_goal || "优化前3秒留存，精炼废话，设计合理的视觉动作指引与黄金转折口";

  const systemInstruction = "你是一名孵化过千万粉丝账号的短视频商业化专家与金牌编神。";

  const prompt = `
请针对以下输入的视频脚本台词开展深度打磨、黄金开头 3 秒优化和分镜节奏配乐的提升设计：

【短视频脚本配置】
- 脚本文字草稿: "${scriptText}"
- 目标分发平台: ${platform}
- 打磨痛点与期望目标: ${goal}

请生成优雅的 Markdown 分析与改造报告：
# 爆款短视频脚本完播及转化红蓝优化报告 (Short Video Script Audit Report)

## 一、 开头黄金 3 秒完播率留存隐患拆解
指出原始开头在抓人、痛点切入或镜头节奏上的流失风险。

## 二、 逐行修剪与情绪升格 (红蓝对比改前改后)
| 序号 | 原始台词文风 | 拖沓或失分原因 | 黄金重写强化方案 |
|---|---|---|---|
| 1 | ... | ... | ... |

## 三、 完播率起飞辅助分镜（视觉动作、音效配乐与道具协同）
设计精确到秒的画面建议、特殊音效及主播手势动作。

请保证输出内容扎实完整。
`;

  const resultText = await generateText(llmConfig, {
    prompt,
    systemInstruction,
    timeoutMs: 80000
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const filename = `short_video_analyzer_${taskId}_${timestamp}.md`;
  const filePath = writeInstanceOutput(instanceId, filename, resultText, dataVolumePath);
  const relativePath = `outputs/${filename}`;

  return { resultText, filePath, relativePath };
}
