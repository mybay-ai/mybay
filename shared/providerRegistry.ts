/**
 * ----------------------------------------------------------------------------
 * SINGLE SOURCE OF TRUTH FOR MODEL PROVIDERS
 * ----------------------------------------------------------------------------
 * 
 * 这是全项目唯一的模型供应商 (Provider)、模型列表 (Models) 和 Base URL 的权威配置源。
 *
 * 任何涉及模型展示、新建实例 (DeployWizard)、配置修改热更新 (AppSettingsLLMSection)、
 * 凭证管理 (CredentialsSection) 以及后端验证的地方，都必须使用此处的数据。
 *
 * 【严禁】在项目其他地方（如 server/providerEnv.ts 或前端组件内部）
 * 维护另一份 Provider / Model 列表，以防止数据不一致或双写错乱。
 *
 * 如果需要新增或修改模型供应商，只允许直接修改本文件。新增项必须同时声明
 * category、networkAccess、badges；如需进入推荐区，再配置 recommendedRank。
 */
export interface ProviderConfig {
  id: string;
  label: string;
  region: "global" | "cn";
  type: "openai-compatible" | "anthropic" | "gemini" | "custom";
  defaultBaseUrl: string;
  defaultModel: string;
  models: string[];
  envPrefix: string;
  alsoInjectEnvPrefix?: string;
  injectOpenAICompatible?: boolean;
  requiresApiKey: boolean;
  testStrategy: "openai-chat-completions" | "openai-responses" | "anthropic-messages" | "gemini-generate-content" | "no-predeploy-test";
  authMode?: "api-key" | "oauth-device-code";
  apiMode?: "chat_completions" | "responses" | "codex_responses";
  authType?: "api_key" | "oauth_device_code" | "oauth_external";
  credentialPool?: string;
  supportsToolCalling?: boolean;
  supportsStreaming?: boolean;
  supportsResponsesApi?: boolean;
  supportsVision?: boolean;
  tokenLimitParameter?: "max_tokens" | "max_completion_tokens";
  enabled: boolean;
  iconUrl?: string;
  hermesProviderId?: string;
  runtimeProvider?: string;
  category: "domestic" | "international" | "aggregator" | "custom";
  networkAccess: "cn-direct" | "global" | "custom";
  badges: Array<"mainstream" | "fast" | "aggregator" | "oauth">;
  recommendedRank?: number;
}

export const providerRegistry: Record<string, ProviderConfig> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    region: "global",
    type: "openai-compatible",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5.5",
    models: ["gpt-5.6-sol","gpt-5.6-terra","gpt-5.6-luna","gpt-5.5", "gpt-5.4", "gpt-5.4-mini"],
    envPrefix: "OPENAI",
    requiresApiKey: true,
    testStrategy: "openai-chat-completions",
    authMode: "api-key",
    apiMode: "chat_completions",
    authType: "api_key",
    supportsToolCalling: true,
    supportsStreaming: true,
    supportsResponsesApi: true,
    supportsVision: true,
    tokenLimitParameter: "max_completion_tokens",
    enabled: true,
    hermesProviderId: "openai-api",
    runtimeProvider: "openai-api",
    category: "international",
    networkAccess: "global",
    badges: ["mainstream"],
    recommendedRank: 3,
    iconUrl: "/assets/logos/openailogo.webp"
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    region: "global",
    type: "gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-3.5-flash",
    models: ["gemini-3.1-pro-preview", "gemini-3.5-flash", "gemini-3-flash-preview"],
    envPrefix: "GEMINI",
    requiresApiKey: true,
    testStrategy: "gemini-generate-content",
    enabled: true,
    category: "international",
    networkAccess: "global",
    badges: ["mainstream"],
    recommendedRank: 4,
    iconUrl: "/assets/logos/geminilogo.webp"
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic Claude",
    region: "global",
    type: "anthropic",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-opus-4-8",
    models: ["claude-fable-5.1", "claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-opus-4-8"],
    envPrefix: "ANTHROPIC",
    requiresApiKey: true,
    testStrategy: "anthropic-messages",
    enabled: true,
    category: "international",
    networkAccess: "global",
    badges: ["mainstream"],
    recommendedRank: 5,
    iconUrl: "/assets/logos/claudelogo.webp"
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek (深度求索)",
    region: "cn",
    type: "openai-compatible",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-v4-flash",
    models: ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-v4-flash-vision-exp"],
    envPrefix: "DEEPSEEK",
    requiresApiKey: true,
    testStrategy: "openai-chat-completions",
    apiMode: "chat_completions",
    authType: "api_key",
    supportsToolCalling: true,
    supportsStreaming: true,
    supportsResponsesApi: false,
    enabled: true,
    category: "domestic",
    networkAccess: "cn-direct",
    badges: ["mainstream"],
    recommendedRank: 1,
    iconUrl: "/assets/logos/deepseeklogo.webp"
  },
  qwen: {
    id: "qwen",
    label: "Qwen / 阿里通义千问",
    region: "cn",
    type: "openai-compatible",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen3.8-flash",
    models: ["qwen3.8-flash", "qwen3.8-max", "qwen3.7-max", "qwen3.7-flash", "qwen3.6-plus", "qwen3.5-plus"],
    envPrefix: "DASHSCOPE",
    requiresApiKey: true,
    testStrategy: "openai-chat-completions",
    enabled: true,
    hermesProviderId: "alibaba",
    runtimeProvider: "alibaba",
    category: "domestic",
    networkAccess: "cn-direct",
    badges: ["mainstream"],
    recommendedRank: 2,
    iconUrl: "/assets/logos/qwenlogo.webp"
  },
  moonshot: {
    id: "moonshot",
    label: "Kimi / Moonshot（中国）",
    region: "cn",
    type: "openai-compatible",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-k2.6",
    models: ["kimi-k3", "kimi-k2.7-code", "kimi-k2.7-code-highspeed", "kimi-k2.6", "kimi-k2.5"],
    envPrefix: "KIMI_CN",
    requiresApiKey: true,
    testStrategy: "openai-chat-completions",
    enabled: true,
    hermesProviderId: "kimi-coding-cn",
    runtimeProvider: "kimi-coding-cn",
    category: "domestic",
    networkAccess: "cn-direct",
    badges: ["mainstream"],
    iconUrl: "/assets/logos/kimilogo.webp"
  },
  kimi: {
    id: "kimi",
    label: "Kimi / Moonshot Global",
    region: "global",
    type: "openai-compatible",
    defaultBaseUrl: "https://api.moonshot.ai/v1",
    defaultModel: "kimi-k2.6",
    models: ["kimi-k3", "kimi-k2.7-code", "kimi-k2.7-code-highspeed", "kimi-k2.6", "kimi-k2.5"],
    envPrefix: "KIMI",
    requiresApiKey: true,
    testStrategy: "openai-chat-completions",
    enabled: true,
    hermesProviderId: "kimi-coding",
    runtimeProvider: "kimi-coding",
    category: "international",
    networkAccess: "global",
    badges: ["mainstream"],
    iconUrl: "/assets/logos/kimilogo.webp"
  },
  minimax: {
    id: "minimax",
    label: "MiniMax Global",
    region: "global",
    type: "openai-compatible",
    defaultBaseUrl: "https://api.minimax.io/v1",
    defaultModel: "MiniMax-M3",
    models: ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.5"],
    envPrefix: "MINIMAX",
    injectOpenAICompatible: true,
    requiresApiKey: true,
    testStrategy: "openai-chat-completions",
    enabled: true,
    category: "international",
    networkAccess: "global",
    badges: [],
    iconUrl: "/assets/logos/minimaxlogo.webp"
  },
  "minimax-cn": {
    id: "minimax-cn",
    label: "MiniMax 中国区 / MiniMax CN",
    region: "cn",
    type: "openai-compatible",
    defaultBaseUrl: "https://api.minimaxi.com/v1",
    defaultModel: "MiniMax-M3",
    models: ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.5"],
    envPrefix: "MINIMAX_CN",
    alsoInjectEnvPrefix: "MINIMAX",
    injectOpenAICompatible: true,
    requiresApiKey: true,
    testStrategy: "openai-chat-completions",
    enabled: true,
    category: "domestic",
    networkAccess: "cn-direct",
    badges: [],
    iconUrl: "/assets/logos/minimaxlogo.webp"
  },
  groq: {
    id: "groq",
    label: "Groq (超轻量加速)",
    region: "global",
    type: "openai-compatible",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-specdec",
    models: ["llama-3.3-70b-specdec", "llama-3.1-70b-versatile", "mixtral-8x7b-32768", "gemma2-9b-it"],
    envPrefix: "GROQ",
    injectOpenAICompatible: true,
    requiresApiKey: true,
    testStrategy: "openai-chat-completions",
    enabled: true,
    category: "international",
    networkAccess: "global",
    badges: ["fast"],
    iconUrl: "/assets/logos/groqlogo.webp"
  },
  zhipu: {
    id: "zhipu",
    label: "Zhipu 清华智谱 GLM",
    region: "cn",
    type: "openai-compatible",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-5.2",
    models: ["glm-5.3-Flash", "glm-5.3", "glm-5.2", "glm-5.1", "glm-5", "glm-4.7"],
    envPrefix: "ZHIPU",
    requiresApiKey: true,
    testStrategy: "openai-chat-completions",
    enabled: true,
    category: "domestic",
    networkAccess: "cn-direct",
    badges: ["mainstream"]
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter (通用聚合)",
    region: "global",
    type: "openai-compatible",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "meta-llama/llama-3.3-70b-instruct",
    models: [
      "openai/gpt-6-astra",
      "openai/gpt-6-astra-fast",
      "openai/gpt-6-astra-flex",
      "openai/gpt-6-astra-pro",
      "openai/gpt-6-astra-pro-fast",
      "openai/gpt-6-astra-pro-flex",
      "anthropic/claude-fable-5.1",
      "meta-llama/llama-3.3-70b-instruct",
      "anthropic/claude-3.5-sonnet",
      "deepseek/deepseek-chat",
      "google/gemini-2.5-flash"
    ],
    envPrefix: "OPENROUTER",
    requiresApiKey: true,
    testStrategy: "openai-chat-completions",
    enabled: true,
    category: "aggregator",
    networkAccess: "global",
    badges: ["aggregator"]
  },
  siliconflow: {
    id: "siliconflow",
    label: "SiliconFlow (硅基流动)",
    region: "cn",
    type: "openai-compatible",
    defaultBaseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "deepseek-ai/DeepSeek-R1",
    models: ["deepseek-ai/DeepSeek-R1", "deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct", "meta-llama/Llama-3.3-70B-Instruct"],
    envPrefix: "SILICONFLOW",
    injectOpenAICompatible: true,
    requiresApiKey: true,
    testStrategy: "openai-chat-completions",
    enabled: true,
    category: "domestic",
    networkAccess: "cn-direct",
    badges: ["aggregator"]
  },
  xai: {
    id: "xai",
    label: "xAI / Grok (API Key)",
    region: "global",
    type: "openai-compatible",
    defaultBaseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-4.5",
    models: ["grok-4.6", "grok-4.5", "grok-4.3"],
    envPrefix: "XAI",
    requiresApiKey: true,
    testStrategy: "openai-responses",
    authMode: "api-key",
    apiMode: "codex_responses",
    authType: "api_key",
    credentialPool: "xai",
    supportsToolCalling: true,
    supportsStreaming: true,
    supportsResponsesApi: true,
    enabled: true,
    supportsVision: true,
    hermesProviderId: "xai",
    runtimeProvider: "xai",
    category: "international",
    networkAccess: "global",
    badges: ["mainstream"]
  },
  "openai-codex": {
    id: "openai-codex",
    label: "OpenAI Codex (ChatGPT OAuth)",
    region: "global",
    type: "openai-compatible",
    defaultBaseUrl: "https://chatgpt.com/backend-api/codex",
    // Keep this list aligned with Hermes Agent's DEFAULT_CODEX_MODELS.
    // These models are available through the ChatGPT OAuth Codex backend,
    // not necessarily through the public OpenAI API.
    defaultModel: "gpt-5.5",
    models: [
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.4-mini",
      "gpt-5.4",
      "gpt-5.3-codex"
    ],
    envPrefix: "",
    requiresApiKey: false,
    testStrategy: "no-predeploy-test",
    authMode: "oauth-device-code",
    apiMode: "codex_responses",
    authType: "oauth_external",
    credentialPool: "openai-codex",
    supportsToolCalling: true,
    supportsStreaming: true,
    supportsResponsesApi: true,
    enabled: true,
    supportsVision: true,
    hermesProviderId: "openai-codex",
    runtimeProvider: "openai-codex",
    category: "international",
    networkAccess: "global",
    badges: ["mainstream", "oauth"]
  },
  "xai-oauth": {
    id: "xai-oauth",
    label: "xAI Grok OAuth (SuperGrok / Premium+)",
    region: "global",
    type: "openai-compatible",
    defaultBaseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-4.5",
    models: ["grok-4.6", "grok-4.5", "grok-4.3"],
    envPrefix: "",
    requiresApiKey: false,
    testStrategy: "no-predeploy-test",
    authMode: "oauth-device-code",
    supportsToolCalling: true,
    supportsStreaming: true,
    supportsResponsesApi: true,
    enabled: true,
    apiMode: "codex_responses",
    authType: "oauth_external",
    credentialPool: "xai-oauth",
    supportsVision: true,
    hermesProviderId: "xai-oauth",
    runtimeProvider: "xai-oauth",
    category: "international",
    networkAccess: "global",
    badges: ["oauth"]
  },
  "custom-openai-compatible": {
    id: "custom-openai-compatible",
    label: "Custom (三方兼容接口)",
    region: "global",
    type: "custom",
    defaultBaseUrl: "",
    defaultModel: "",
    models: [],
    envPrefix: "CUSTOM",
    requiresApiKey: false,
    testStrategy: "openai-chat-completions",
    enabled: true,
    hermesProviderId: "custom-openai-compatible",
    runtimeProvider: "custom-openai-compatible",
    category: "custom",
    networkAccess: "custom",
    badges: []
  },

  mistral: {
    id: "mistral",
    label: "Mistral AI (法国领头羊)",
    region: "global",
    type: "openai-compatible",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-medium-latest",
    models: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest", "codestral-latest"],
    envPrefix: "MISTRAL",
    requiresApiKey: true,
    testStrategy: "openai-chat-completions",
    enabled: true,
    category: "international",
    networkAccess: "global",
    badges: []
  },
  together: {
    id: "together",
    label: "Together AI",
    region: "global",
    type: "openai-compatible",
    defaultBaseUrl: "https://api.together.ai/v1",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "openai/gpt-oss-120b", "Qwen/Qwen3.7-Max", "deepseek-ai/DeepSeek-V4-Flash-0731"],
    envPrefix: "TOGETHER",
    requiresApiKey: true,
    testStrategy: "openai-chat-completions",
    enabled: true,
    hermesProviderId: "togetherai",
    runtimeProvider: "togetherai",
    category: "aggregator",
    networkAccess: "global",
    badges: ["aggregator"]
  }
};

export const DEMO_ALLOWED_MODELS = [
  "deepseek-v4-flash",
  "gpt-5.4-mini",
  "gemini-3-flash-preview"
];

export const DEMO_DEFAULT_MODEL = "gemini-3-flash-preview";
export const DEMO_DEFAULT_PROVIDER = "gemini";
