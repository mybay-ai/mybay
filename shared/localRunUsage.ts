/** Local observations only. Never add terminal/session snapshots together. */
export interface LocalRunUsage {
  version: 1;
  source: "runtime_terminal" | "provider_response" | "legacy";
  scope: "run" | "session" | "model_call" | "unknown";
  counter: "snapshot";
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  modelCalls: number | null;
  model: string | null;
  durationMs: number | null;
  durationSource: "runtime" | "local_elapsed" | "unknown";
}

export function usageNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function usageModel(value: unknown): string | null {
  return typeof value === "string" && value.length <= 160 && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(value)
    && !/(?:sk-|api[_-]?key|secret|password|token)/i.test(value) ? value : null;
}
export function createLocalRunUsage(raw: unknown, options: {
  source?: LocalRunUsage["source"];
  durationMs?: unknown;
  durationSource?: LocalRunUsage["durationSource"];
} = {}): LocalRunUsage {
  const item = record(raw);
  const details = record(item.prompt_tokens_details ?? item.input_tokens_details);
  const first = (...values: unknown[]) => usageNumber(values.find(value => value !== undefined && value !== null));
  return {
    version: 1, source: options.source ?? "runtime_terminal", counter: "snapshot",
    scope: item.scope === "run" || item.scope === "session" || item.scope === "model_call" ? item.scope : "unknown",
    inputTokens: first(item.prompt_tokens, item.input_tokens, item.inputTokens, item.promptTokenCount),
    outputTokens: first(item.completion_tokens, item.output_tokens, item.outputTokens, item.candidatesTokenCount),
    totalTokens: first(item.total_tokens, item.totalTokens, item.totalTokenCount),
    cacheReadTokens: first(details.cached_tokens, item.cache_read_input_tokens, item.cache_read_tokens, item.cached_tokens, item.cachedContentTokenCount),
    cacheWriteTokens: first(item.cache_creation_input_tokens, item.cache_write_tokens),
    modelCalls: first(item.api_call_count, item.api_calls, item.model_call_count),
    model: usageModel(item.model),
    durationMs: usageNumber(options.durationMs),
    durationSource: usageNumber(options.durationMs) === null ? "unknown" : options.durationSource ?? "runtime",
  };
}

export function usageWithReportedModel(raw: unknown, model: unknown): unknown {
  const reportedModel = usageModel(model);
  return reportedModel ? { ...record(raw), model: reportedModel } : raw;
}

/** Rebuild a fixed allowlist at storage and presentation boundaries. */
export function readLocalRunUsage(raw: unknown): LocalRunUsage | null {
  const item = record(raw);
  if (item.version !== 1 || !["runtime_terminal", "provider_response", "legacy"].includes(String(item.source))) return null;
  return createLocalRunUsage({
    scope: item.scope, input_tokens: item.inputTokens, output_tokens: item.outputTokens,
    total_tokens: item.totalTokens, cache_read_tokens: item.cacheReadTokens,
    cache_write_tokens: item.cacheWriteTokens, api_calls: item.modelCalls, model: item.model,
  }, { source: item.source as LocalRunUsage["source"], durationMs: item.durationMs,
    durationSource: item.durationSource === "runtime" || item.durationSource === "local_elapsed" ? item.durationSource : "unknown" });
}
