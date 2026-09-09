const PI_PROVIDER_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  openai: "openai",
  "openai-api": "openai",
  anthropic: "anthropic",
  deepseek: "deepseek",
  google: "google",
  gemini: "google",
  groq: "groq",
  mistral: "mistral",
  openrouter: "openrouter",
  xai: "xai",
});

export const PI_QUICK_DEPLOY_PROVIDER_IDS = Object.freeze([
  "openai",
  "anthropic",
  "deepseek",
  "gemini",
  "groq",
  "mistral",
  "openrouter",
  "xai",
] as const);

export function resolvePiRuntimeProvider(provider: unknown): string | null {
  return PI_PROVIDER_ALIASES[String(provider || "").trim().toLowerCase()] || null;
}

export function supportsQuickDeployRuntimeProvider(runtimeType: unknown, provider: unknown): boolean {
  if (String(runtimeType).trim().toLowerCase() === "codex") return provider === "openai";
  return String(runtimeType || "hermes").trim().toLowerCase() !== "pi"
    || resolvePiRuntimeProvider(provider) !== null;
}
