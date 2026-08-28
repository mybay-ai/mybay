import { providerRegistry, type ProviderConfig } from "./providerRegistry";

export type ProviderDisplayGroupId = "recommended" | ProviderConfig["category"];

export interface ProviderDisplayGroup {
  id: ProviderDisplayGroupId;
  providers: ProviderConfig[];
}

function normalizeText(value?: string | null): string {
  return String(value || "").trim().toLowerCase();
}

function normalizeBaseUrl(value?: string | null): string {
  const normalized = normalizeText(value);
  let end = normalized.length;
  while (end > 0 && normalized.charCodeAt(end - 1) === 47) end -= 1;
  return normalized.slice(0, end);
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

const PROVIDER_GROUP_ORDER: ProviderDisplayGroupId[] = [
  "recommended",
  "domestic",
  "international",
  "aggregator",
  "custom"
];

export function getProviderDisplayGroups({
  query = "",
  includeOAuth = true,
  providers = Object.values(providerRegistry)
}: {
  query?: string;
  includeOAuth?: boolean;
  providers?: ProviderConfig[];
} = {}): ProviderDisplayGroup[] {
  const normalizedQuery = normalizeText(query);
  const eligible = providers.filter((provider) => {
    if (!provider.enabled) return false;
    if (!includeOAuth && provider.authMode === "oauth-device-code") return false;
    if (!normalizedQuery) return true;
    return [
      provider.id,
      provider.label,
      provider.category,
      provider.networkAccess,
      ...provider.badges,
      ...provider.models
    ].some((value) => normalizeText(value).includes(normalizedQuery));
  });

  const recommendedIds = new Set(
    eligible.filter((provider) => provider.recommendedRank !== undefined).map((provider) => provider.id)
  );

  return PROVIDER_GROUP_ORDER.map((groupId) => {
    const groupProviders = eligible
      .filter((provider) => groupId === "recommended"
        ? recommendedIds.has(provider.id)
        : !recommendedIds.has(provider.id) && provider.category === groupId)
      .sort((left, right) => groupId === "recommended"
        ? (left.recommendedRank ?? Number.MAX_SAFE_INTEGER) - (right.recommendedRank ?? Number.MAX_SAFE_INTEGER)
        : left.label.localeCompare(right.label));
    return { id: groupId, providers: groupProviders };
  }).filter((group) => group.providers.length > 0);
}
