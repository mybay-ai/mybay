import { generateText, LLMConfig } from "../utils/llmClient";
import { writeInstanceOutput } from "../utils/outputWriter";

export interface XiaohongshuTopicInputs {
  niche: string;
  target_audience: string;
  competitor_accounts?: string;
  content_style: string;
}

/**
 * Executes the 小红书选题生成 template.
 * Generates beautiful爆款选题 suggestions & sample draft and saves them as a markdown file.
 */
export async function runXiaohongshuTopicGenerator(
  instanceId: string,
  taskId: string,
  inputs: XiaohongshuTopicInputs,
  llmConfig: LLMConfig,
  dataVolumePath?: string | null
): Promise<{ resultText: string; filePath: string; relativePath: string }> {
  const styleLabelMap: Record<string, string> = {
    emotional: "情感共鸣",
    technical: "硬核干货",
    lifestyle: "生活分享"
  };
  
  const formattedStyle = styleLabelMap[inputs.content_style] || inputs.content_style || "情感共鸣";

  const systemInstruction = 
    `你是一名在小红书拥有百万粉丝的爆款内容策划总监（MCN导师），对小红书平台的推荐算法、流量分发机制、爆款公式以及小红书深受用户喜爱的特有风格调性了如指掌。你精通如何通过痛点切入和情感钩子瞬间抓住用户注意力，创造超高点击和互动。`;

  const prompt = `
请基于以下输入的配置参数，为博主制定一份深度的小红书爆款选题大纲和一篇完整的笔记示范：

【博主基础属性配置】
- 账号垂直定位：${inputs.niche || '未提供'}
- 针对目标受众：${inputs.target_audience || '未提供'}
- 竞品/对标博主：${inputs.competitor_accounts || '暂无'}
- 表达文风调性：${formattedStyle}

请在输出的 Markdown 报告中提供以下具体模块：

# 小红书爆款选题策划盘点报告 (Xiaohongshu Topic Report)

## 一、 核心定位与用户画像深度洞察
1. **账号定位精准理解**：从专业创作者角度深度拆解该赛道的差异化起号策略、视觉包装建议。
2. **核心受众画像解析**：梳理目标人群的日常生活切盘、高频社交槽点，以及其深层次、高共鸣、易转化吐槽的情感痛点与现实焦虑。

## 二、 10 款极具爆款潜力的选题矩阵策划
（请精心组织产出 10 个成套系列化选题，选题必须符合“${formattedStyle}”调性，并在选题中深度嵌入利他感、反常识、或者情绪充沛等爆款元素，具体包括以下各项内容：）

${Array.from({ length: 10 }).map((_, i) => `
### 选题 ${i + 1}：[选题大方向名称]
- **【内容角度与痛点核心】**：一句话阐释为什么这个选题能引起受众狂热、击中什么隐秘痛点。
- **【封面设计与备选标题】**：（提供至少 3 个高点击率、极具情绪价值的手写/主图标题建议，必须控制在 18 字以内，含小红书风格 emoji 表情）
- **【正文黄金开头勾人钩子】**：（设计 1 句话正文黄金开口，在小红书前 3 秒卡点极度吸睛，引发强烈代入感）
- **【笔记正文核心逻辑梗概】**：（说明这篇笔记正文如何层层递进、提供何种痛点利益）
- **【爆款标签话题推荐】**：（提供 5 个相关度极高的爆款热搜标签，如：#xxx #yyy）
`).join("")}

## 三、 金牌爆款笔记草稿示范
从上述 10 个选题中选择一个最具备爆款潜力的核心大爆选题，撰写一份可**直接发布**的高质量小红书标准笔记。
- **吸睛爆款标题**：提供 2 款。
- **正文内容（带情绪Emoji排版）**：使用网感丰富、精致分段、带有引导评论互动和接地气小红书话术的正文草稿（正文包含吸引眼球开头、痛点展开与痛点抚平、行动号召等细节）。
- **聚合热门标签**：最全标签展示。

输出格式要求：请完全使用 Markdown 规范进行排版输出。不用附带任何除 Markdown 文本外的代码，字数饱满、质量极高。
`;

  // Start generation (80s maximum limit)
  const resultText = await generateText(llmConfig, {
    prompt,
    systemInstruction,
    timeoutMs: 80000
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const filename = `xiaohongshu_topics_${taskId}_${timestamp}.md`;
  
  // Persist report locally in outputs folder
  const filePath = writeInstanceOutput(instanceId, filename, resultText, dataVolumePath);
  const relativePath = `outputs/${filename}`;

  return {
    resultText,
    filePath,
    relativePath
  };
}
