import { providerRegistry } from "../../shared/providerRegistry";
import { decrypt } from "../crypto";
import { checkSSRFSafe } from "./ssrfValidator";

export interface LLMConfig {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  providerApiKey?: string;
}

export interface GenerateTextOptions {
  prompt: string;
  systemInstruction?: string;
  timeoutMs?: number;
}

export interface ChatCompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerateChatCompletionOptions {
  messages: ChatCompletionMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ChatCompletionResult {
  content: string;
  usage?: any;
}

/**
 * Normalizes input provider strings for registry lookup (e.g. "custom" -> "custom-openai-compatible")
 */
function getNormalizedRegistryKey(provider: string): string {
  const lower = String(provider || "").toLowerCase();
  if (lower === "custom" || lower === "custom-openai-compatible" || lower === "openai-compatible") {
    return "custom-openai-compatible";
  }
  return lower;
}

function resolveLLMRuntime(llmConfig: LLMConfig) {
  const regKey = getNormalizedRegistryKey(llmConfig.provider);
  const conf = providerRegistry[regKey];

  let baseUrl = llmConfig.baseUrl || "";
  let model = llmConfig.model || "";

  if (conf) {
    if (!baseUrl) {
      baseUrl = conf.defaultBaseUrl;
    }
    if (!model) {
      model = conf.defaultModel;
    }
  }

  let decryptedApiKey = "";
  const encryptedKey = llmConfig.providerApiKey || llmConfig.apiKey || "";
  if (encryptedKey) {
    try {
      decryptedApiKey = decrypt(encryptedKey);
    } catch (e) {
      decryptedApiKey = encryptedKey;
    }
  }

  let oauthPayload: any = null;
  if (decryptedApiKey && (regKey === "openai-codex" || regKey === "xai-oauth")) {
    try {
      const parsed = JSON.parse(decryptedApiKey);
      if (parsed?.tokens?.access_token) oauthPayload = parsed;
    } catch {}
  }
  if (oauthPayload?.tokens?.access_token) {
    decryptedApiKey = String(oauthPayload.tokens.access_token);
  }

  if (!decryptedApiKey) {
    if (regKey === "gemini") {
      decryptedApiKey = process.env.GEMINI_API_KEY || "";
    } else if (regKey === "openai") {
      decryptedApiKey = process.env.OPENAI_API_KEY || "";
    } else if (conf?.envPrefix) {
      decryptedApiKey = process.env[`${conf.envPrefix}_API_KEY`] || "";
    }
  }

  if (!decryptedApiKey) {
    throw new Error(`无法获取服务商 "${llmConfig.provider}" 的 API 密钥，请确认实例或平台环境变量已配置。`);
  }

  return {
    regKey,
    conf,
    baseUrl,
    model,
    decryptedApiKey,
    oauthPayload,
    strategy: oauthPayload ? "codex-responses" : (conf ? conf.testStrategy : "openai-chat-completions")
  };
}

function resolveOAuthAccountId(payload: any, accessToken: string): string | undefined {
  const direct = payload?.tokens?.account_id || payload?.account_id;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const parts = accessToken.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const accountId = claims?.["https://api.openai.com/auth"]?.chatgpt_account_id;
    return typeof accountId === "string" && accountId.trim() ? accountId.trim() : undefined;
  } catch {
    return undefined;
  }
}

function responsesInputFromMessages(messages: Array<{ role: string; content: string }>) {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: [{
        type: message.role === "assistant" ? "output_text" : "input_text",
        text: message.content,
      }],
    }));
}

export async function readOAuthResponsesStream(response: Response): Promise<ChatCompletionResult> {
  if (!response.body) throw new Error("OAuth Responses endpoint returned an empty stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let usage: any = null;

  const consumeEvent = (rawEvent: string) => {
    const data = rawEvent
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") return;
    let event: any;
    try { event = JSON.parse(data); } catch { return; }
    if (event.type === "response.failed" || event.type === "error") {
      const message = event.response?.error?.message || event.error?.message || event.error || "Responses API execution failed";
      throw new Error(`LLM 供应商返回错误: ${message}`);
    }
    if (event.type === "response.incomplete") {
      const reason = event.response?.incomplete_details?.reason || event.incomplete_details?.reason;
      if (reason === "error" || reason === "failed") {
        const message = event.response?.error?.message || event.error?.message || "Responses stream failed";
        throw new Error(`LLM 供应商返回错误: ${message}`);
      }
    }
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") content += event.delta;
    if (event.type === "response.output_text.done" && !content && typeof event.text === "string") content = event.text;
    if (event.response?.usage) usage = event.response.usage;
    else if (event.usage) usage = event.usage;
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || "";
    for (const event of events) consumeEvent(event);
    if (done) break;
  }
  if (buffer.trim()) consumeEvent(buffer);
  return { content, usage: usage || null };
}

async function assertSafeLLMRequestUrl(url: string): Promise<void> {
  const result = await checkSSRFSafe(url);
  if (result.safe) return;

  const error = new Error("模型服务地址未通过 SSRF 安全校验，请检查 API Base URL 配置。");
  (error as Error & { code?: string }).code = "LLM_BASE_URL_UNSAFE";
  throw error;
}

export async function generateChatCompletion(
  llmConfig: LLMConfig,
  options: GenerateChatCompletionOptions
): Promise<ChatCompletionResult> {
  const { regKey, conf, baseUrl, model, decryptedApiKey, oauthPayload, strategy } = resolveLLMRuntime(llmConfig);
  const timeoutMs = options.timeoutMs || 60000;
  const controller = new AbortController();
  const abortFromExternalSignal = () => {
    if (!controller.signal.aborted) {
      controller.abort(options.signal?.reason || new DOMException("Chat request cancelled", "AbortError"));
    }
  };
  if (options.signal?.aborted) {
    abortFromExternalSignal();
  } else {
    options.signal?.addEventListener("abort", abortFromExternalSignal, { once: true });
  }
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  const normalizedMessages = options.messages
    .filter((msg) => msg && typeof msg.content === "string" && msg.content.trim())
    .map((msg) => ({ role: msg.role, content: msg.content }));

  if (normalizedMessages.length === 0) {
    throw new Error("缺少有效的对话消息。");
  }

  const maxTokens = Math.min(Math.max(options.maxTokens || 768, 1), 2048);

  try {
    let url = "";
    const opts: any = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      redirect: "manual"
    };

    if (strategy === "codex-responses") {
      url = `${baseUrl.replace(/\/$/, "")}/responses`;
      opts.headers["Authorization"] = `Bearer ${decryptedApiKey}`;
      opts.headers.Accept = "text/event-stream";
      opts.headers["User-Agent"] = "mybay-local-quick-chat";
      if (regKey === "openai-codex") {
        const accountId = resolveOAuthAccountId(oauthPayload, decryptedApiKey);
        if (accountId) opts.headers["ChatGPT-Account-Id"] = accountId;
      }
      const instructions = normalizedMessages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n") || undefined;
      opts.body = JSON.stringify({
        model,
        input: responsesInputFromMessages(normalizedMessages),
        store: false,
        stream: true,
        ...(instructions ? { instructions } : {}),
      });
    } else if (strategy === "anthropic-messages") {
      url = `${baseUrl.replace(/\/$/, "")}/messages`;
      opts.headers["x-api-key"] = decryptedApiKey;
      opts.headers["anthropic-version"] = "2023-06-01";

      const systemText = normalizedMessages
        .filter((msg) => msg.role === "system")
        .map((msg) => msg.content)
        .join("\n\n") || undefined;
      const anthropicMessages = normalizedMessages
        .filter((msg) => msg.role !== "system")
        .map((msg) => ({ role: msg.role === "assistant" ? "assistant" : "user", content: msg.content }));

      opts.body = JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: typeof options.temperature === "number" ? options.temperature : undefined,
        system: systemText,
        messages: anthropicMessages
      });
    } else if (strategy === "gemini-generate-content") {
      url = `${baseUrl.replace(/\/$/, "")}/models/${model}:generateContent?key=${decryptedApiKey}`;
      const systemText = normalizedMessages
        .filter((msg) => msg.role === "system")
        .map((msg) => msg.content)
        .join("\n\n") || undefined;
      const contents = normalizedMessages
        .filter((msg) => msg.role !== "system")
        .map((msg) => ({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }]
        }));

      const payload: any = {
        contents,
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: typeof options.temperature === "number" ? options.temperature : undefined
        }
      };
      if (systemText) {
        payload.systemInstruction = { parts: [{ text: systemText }] };
      }
      opts.body = JSON.stringify(payload);
    } else {
      url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
      opts.headers["Authorization"] = `Bearer ${decryptedApiKey}`;

      const isOfficialOpenAI = regKey === "openai" || url.includes("api.openai.com");
      const tokenParam = conf?.tokenLimitParameter || (isOfficialOpenAI ? "max_completion_tokens" : "max_tokens");
      const body: any = {
        model,
        messages: normalizedMessages,
        temperature: typeof options.temperature === "number" ? options.temperature : undefined
      };
      body[tokenParam] = maxTokens;
      opts.body = JSON.stringify(body);
    }

    await assertSafeLLMRequestUrl(url);
    const response = await fetch(url, opts);
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      let parsedErr: any;
      try {
        parsedErr = JSON.parse(errorText);
      } catch (e) {}

      const msg = parsedErr?.error?.message || parsedErr?.error || errorText || `HTTP 错误 ${response.status}`;
      throw new Error(`LLM 供应商 [${llmConfig.provider}] 返回错误: ${msg}`);
    }

    if (strategy === "codex-responses") {
      return await readOAuthResponsesStream(response);
    }

    const resJson = await response.json();

    if (strategy === "anthropic-messages") {
      if (resJson.content && Array.isArray(resJson.content)) {
        return {
          content: resJson.content.map((pt: any) => pt.text || "").join("\n"),
          usage: resJson.usage || null
        };
      }
      throw new Error("Anthropic 接口响应结构解析失败");
    } else if (strategy === "gemini-generate-content") {
      const parts = resJson.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        return {
          content: parts.map((pt: any) => pt.text || "").join(""),
          usage: resJson.usageMetadata || null
        };
      }
      throw new Error("Gemini 接口响应结构解析失败");
    } else {
      const choiceText = resJson.choices?.[0]?.message?.content;
      if (typeof choiceText === "string") {
        return {
          content: choiceText,
          usage: resJson.usage || null
        };
      }
      throw new Error("OpenAI 规格接口未返回有效的 choices[0].message.content 文本内容");
    }
  } catch (err: any) {
    if (err.name === "AbortError") {
      if (options.signal?.aborted) {
        throw options.signal.reason instanceof Error
          ? options.signal.reason
          : new DOMException("Chat request cancelled", "AbortError");
      }
      throw new Error(`调用大模型 ${model} 超时无响应，最大执行时限为 ${timeoutMs / 1000} 秒`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", abortFromExternalSignal);
  }
}

/**
 * High-reliability generator to query LLMs using native fetch depending on their provider type
 */
export async function generateText(llmConfig: LLMConfig, options: GenerateTextOptions): Promise<string> {
  const regKey = getNormalizedRegistryKey(llmConfig.provider);
  const conf = providerRegistry[regKey];

  let baseUrl = llmConfig.baseUrl || "";
  let model = llmConfig.model || "";

  if (conf) {
    if (!baseUrl) {
      baseUrl = conf.defaultBaseUrl;
    }
    if (!model) {
      model = conf.defaultModel;
    }
  }

  // 1. Decrypt configured key if present
  let decryptedApiKey = "";
  const encryptedKey = llmConfig.providerApiKey || llmConfig.apiKey || "";
  if (encryptedKey) {
    try {
      decryptedApiKey = decrypt(encryptedKey);
    } catch (e) {
      // In case it's stored in plain text or decrypt fails, fallback
      decryptedApiKey = encryptedKey;
    }
  }

  // 2. Global environment fallbacks if no instance credential key is supplied
  if (!decryptedApiKey) {
    if (regKey === "gemini") {
      decryptedApiKey = process.env.GEMINI_API_KEY || "";
    } else if (regKey === "openai") {
      decryptedApiKey = process.env.OPENAI_API_KEY || "";
    } else if (conf?.envPrefix) {
      decryptedApiKey = process.env[`${conf.envPrefix}_API_KEY`] || "";
    }
  }

  if (!decryptedApiKey) {
    throw new Error(`无法获取服务商 "${llmConfig.provider}" 的 API 密钥（凭证）。请确认已配置有效的平台密钥或在设置面板配置了该实例的密钥。`);
  }

  const strategy = conf ? conf.testStrategy : "openai-chat-completions";
  const timeoutMs = options.timeoutMs || 60000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    let url = "";
    let opts: any = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      redirect: "manual"
    };

    if (strategy === "anthropic-messages") {
      url = `${baseUrl.replace(/\/$/, "")}/messages`;
      opts.headers["x-api-key"] = decryptedApiKey;
      opts.headers["anthropic-version"] = "2023-06-01";
      opts.body = JSON.stringify({
        model,
        max_tokens: 4000,
        system: options.systemInstruction || undefined,
        messages: [{ role: "user", content: options.prompt }]
      });
    } else if (strategy === "gemini-generate-content") {
      // If offficial Gemini, support beta or standard endpoint
      url = `${baseUrl.replace(/\/$/, "")}/models/${model}:generateContent?key=${decryptedApiKey}`;
      const payload: any = {
        contents: [{ parts: [{ text: options.prompt }] }]
      };
      if (options.systemInstruction) {
        payload.systemInstruction = {
          parts: [{ text: options.systemInstruction }]
        };
      }
      opts.body = JSON.stringify(payload);
    } else {
      // Default / standard openai compatible strategy
      url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
      opts.headers["Authorization"] = `Bearer ${decryptedApiKey}`;

      const isOfficialOpenAI = regKey === "openai" || url.includes("api.openai.com");
      const tokenParam = conf?.tokenLimitParameter || (isOfficialOpenAI ? "max_completion_tokens" : "max_tokens");

      const messages: any[] = [];
      if (options.systemInstruction) {
        messages.push({ role: "system", content: options.systemInstruction });
      }
      messages.push({ role: "user", content: options.prompt });

      const body: any = {
        model,
        messages
      };
      body[tokenParam] = 4000;

      opts.body = JSON.stringify(body);
    }

    await assertSafeLLMRequestUrl(url);
    const response = await fetch(url, opts);
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      let parsedErr: any;
      try {
        parsedErr = JSON.parse(errorText);
      } catch (e) {}

      const msg = parsedErr?.error?.message || parsedErr?.error || errorText || `HTTP 错误 ${response.status}`;
      throw new Error(`LLM 供应商 [${llmConfig.provider}] 返回错误: ${msg}`);
    }

    const resJson = await response.json();

    if (strategy === "anthropic-messages") {
      if (resJson.content && Array.isArray(resJson.content)) {
        return resJson.content.map((pt: any) => pt.text || "").join("\n");
      }
      throw new Error("Anthropic 接口响应结构解析失败");
    } else if (strategy === "gemini-generate-content") {
      const parts = resJson.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        return parts.map((pt: any) => pt.text || "").join("");
      }
      throw new Error("Gemini 接口响应结构解析失败，未能获得有效的候选内容大纲（candidates）");
    } else {
      const choiceText = resJson.choices?.[0]?.message?.content;
      if (typeof choiceText === 'string') {
        return choiceText;
      }
      throw new Error("OpenAI 规格接口未返回有效的 choices[0].message.content 文本内容");
    }

  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw new Error(`调用大模型 ${model} 超时无响应，最大执行时限为 ${timeoutMs / 1000} 秒`);
    }
    throw err;
  }
}
