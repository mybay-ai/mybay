import { providerRegistry, type ProviderConfig } from "./providerRegistry";

function normalizeText(value?: string | null): string {
  return String(value || "").trim().toLowerCase();
}

function normalizeBaseUrl(value?: string | null): string {
  return normalizeText(value).replace(/\/+$/, "");
}

const PROVIDER_ALIASES: Record<string, string> = {
  "kimi-cn": "moonshot",
  "moonshot-cn": "moonshot",
  "kimi-coding-cn": "moonshot",
  "kimi-global": "kimi",
  "moonshot-global": "kimi",
  "kimi-coding": "kimi",
  "custom": "custom-openai-compatible"
};

/**
 * Resolve any stored provider value to the canonical MyBay providerRegistry key.
 * The UI must use canonical MyBay provider ids such as "openai" or "moonshot".
 * Hermes runtime provider ids such as "openai-api" are only for container config.
 */
export function resolveProviderRegistryKey(
  provider?: string | null,
  model?: string | null,
  baseUrl?: string | null
): string {
  const rawProvider = normalizeText(provider);
  const rawModel = normalizeText(model);
  const rawBaseUrl = normalizeBaseUrl(baseUrl);

  if (rawProvider && providerRegistry[rawProvider]) {
    return rawProvider;
  }

  if (rawProvider && PROVIDER_ALIASES[rawProvider]) {
    return PROVIDER_ALIASES[rawProvider];
  }

  const entries = Object.entries(providerRegistry).filter(([, conf]) => conf.enabled);

  if (rawProvider) {
    const byRuntimeProvider = entries.find(([, conf]) =>
      normalizeText(conf.runtimeProvider) === rawProvider || normalizeText(conf.hermesProviderId) === rawProvider
    );
    if (byRuntimeProvider) return byRuntimeProvider[0];
  }

  if (rawModel) {
    const byModel = entries.find(([, conf]) =>
      (conf.models || []).some(item => normalizeText(item) === rawModel)
    );
    if (byModel) return byModel[0];
  }

  if (rawBaseUrl) {
    const byBaseUrl = entries.find(([, conf]) =>
      normalizeBaseUrl(conf.defaultBaseUrl) === rawBaseUrl
    );
    if (byBaseUrl) return byBaseUrl[0];
  }

  return rawProvider || "gemini";
}

export function getProviderConfig(
  provider?: string | null,
  model?: string | null,
  baseUrl?: string | null
): ProviderConfig | undefined {
  return providerRegistry[resolveProviderRegistryKey(provider, model, baseUrl)];
}

export function getProviderModels(
  provider?: string | null,
  model?: string | null,
  baseUrl?: string | null
): string[] {
  return getProviderConfig(provider, model, baseUrl)?.models || [];
}
