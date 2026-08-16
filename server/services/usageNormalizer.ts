export type UsageSchema = "openai" | "hermes_session" | "anthropic" | "generic";

export interface NormalizeUsageOptions {
  schemaHint?: UsageSchema;
}

export interface NormalizedUsage {
  usageSchema: UsageSchema;
  uncachedInputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  reportedTotalTokens: number | null;
  accountedTotalTokens: number;
  apiCallCount: number;
  toolCallCount: number;
  childSessionCount: number;
  cacheWriteIncludedInInput: "unknown";
  reasoningIncludedInOutput: "unknown";
  anomalies: string[];
  rawUsageKeys: string[];
}

function parseNonNegativeInt(val: any): number {
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function normalizeUsage(raw: any, options?: NormalizeUsageOptions): NormalizedUsage {
  if (!raw || typeof raw !== "object") {
    return {
      usageSchema: options?.schemaHint || "generic",
      uncachedInputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      reportedTotalTokens: null,
      accountedTotalTokens: 0,
      apiCallCount: 0,
      toolCallCount: 0,
      childSessionCount: 0,
      cacheWriteIncludedInInput: "unknown",
      reasoningIncludedInOutput: "unknown",
      anomalies: ["raw_usage_empty_or_null"],
      rawUsageKeys: []
    };
  }

  const rawUsageKeys = Object.keys(raw);
  const anomalies: string[] = [];

  // 1. Raw field extraction
  const rawInput = raw.input_tokens ?? raw.prompt_tokens ?? raw.inputTokens ?? raw.promptTokens;
  const inputTokens = parseNonNegativeInt(rawInput);

  const rawOutput = raw.output_tokens ?? raw.completion_tokens ?? raw.outputTokens ?? raw.completionTokens;
  const outputTokens = parseNonNegativeInt(rawOutput);

  const rawReportedTotal = raw.total_tokens ?? raw.totalTokens;
  const reportedTotalTokens = rawReportedTotal !== undefined && rawReportedTotal !== null
    ? parseNonNegativeInt(rawReportedTotal)
    : null;

  const reasoningTokens = parseNonNegativeInt(
    raw.reasoning_tokens ??
    raw.reasoningTokens ??
    raw.completion_tokens_details?.reasoning_tokens ??
    raw.completionTokensDetails?.reasoningTokens
  );

  const apiCallCount = parseNonNegativeInt(
    raw.api_call_count ?? raw.api_calls ?? raw.apiCallCount ?? raw.apiCalls
  );

  const toolCallCount = parseNonNegativeInt(
    raw.tool_call_count ?? raw.tool_calls ?? raw.toolCallCount ?? raw.toolCalls
  );

  const childSessionCount = parseNonNegativeInt(
    raw.child_session_count ?? raw.child_sessions ?? raw.childSessionCount ?? raw.childSessions
  );

  // 2. Schema Determination Order
  let usageSchema: UsageSchema = "generic";
  const validHints: UsageSchema[] = ["openai", "hermes_session", "anthropic", "generic"];
  
  if (options?.schemaHint && validHints.includes(options.schemaHint)) {
    usageSchema = options.schemaHint;
  } else if (raw.prompt_tokens_details?.cached_tokens !== undefined || raw.promptTokensDetails?.cachedTokens !== undefined) {
    // Priority 1: OpenAI prompt_tokens_details.cached_tokens
    usageSchema = "openai";
  } else if (raw.cache_read_input_tokens !== undefined || raw.cacheReadInputTokens !== undefined || raw.cache_creation_input_tokens !== undefined || raw.cacheCreationInputTokens !== undefined) {
    // Priority 2: Anthropic specific fields
    usageSchema = "anthropic";
  } else if (raw.cache_read_tokens !== undefined || raw.cacheReadTokens !== undefined || raw.cache_write_tokens !== undefined || raw.cacheWriteTokens !== undefined) {
    // Priority 3: Hermes Session specific fields
    usageSchema = "hermes_session";
  } else if (raw.prompt_tokens !== undefined || raw.completion_tokens !== undefined) {
    usageSchema = "openai";
  }

  // 3. Token Breakdown by Schema
  let uncachedInputTokens = 0;
  let cachedInputTokens = 0;
  let cacheWriteTokens = 0;

  if (usageSchema === "openai") {
    cachedInputTokens = parseNonNegativeInt(
      raw.prompt_tokens_details?.cached_tokens ??
      raw.promptTokensDetails?.cachedTokens ??
      raw.cached_tokens ??
      raw.cachedTokens
    );
    cacheWriteTokens = parseNonNegativeInt(
      raw.prompt_tokens_details?.cache_creation_input_tokens ??
      raw.promptTokensDetails?.cacheCreationInputTokens ??
      raw.cache_write_tokens ??
      raw.cacheWriteTokens
    );
    if (cachedInputTokens > inputTokens) {
      anomalies.push("openai_cached_tokens_exceed_prompt_tokens");
      uncachedInputTokens = inputTokens;
    } else {
      uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
    }
  } else if (usageSchema === "anthropic") {
    uncachedInputTokens = inputTokens;
    cachedInputTokens = parseNonNegativeInt(
      raw.cache_read_input_tokens ??
      raw.cacheReadInputTokens ??
      raw.cache_read_tokens ??
      raw.cacheReadTokens
    );
    cacheWriteTokens = parseNonNegativeInt(
      raw.cache_creation_input_tokens ??
      raw.cacheCreationInputTokens ??
      raw.cache_write_tokens ??
      raw.cacheWriteTokens
    );
  } else if (usageSchema === "hermes_session") {
    // Hermes Session: input_tokens and cache_read_tokens are independent fields
    uncachedInputTokens = inputTokens;
    cachedInputTokens = parseNonNegativeInt(
      raw.cache_read_tokens ??
      raw.cacheReadTokens ??
      raw.cached_tokens ??
      raw.cachedTokens
    );
    cacheWriteTokens = parseNonNegativeInt(
      raw.cache_write_tokens ??
      raw.cacheWriteTokens
    );
  } else {
    // Generic fallback
    const genericCached = parseNonNegativeInt(raw.cached_tokens ?? raw.cachedTokens ?? raw.cache_read_tokens);
    if (genericCached > 0) {
      if (genericCached > inputTokens) {
        usageSchema = "hermes_session";
        uncachedInputTokens = inputTokens;
        cachedInputTokens = genericCached;
        anomalies.push("generic_cached_tokens_exceed_input_tokens_treated_as_independent");
      } else {
        usageSchema = "openai";
        cachedInputTokens = genericCached;
        uncachedInputTokens = Math.max(0, inputTokens - genericCached);
      }
    } else {
      usageSchema = "generic";
      uncachedInputTokens = inputTokens;
      cachedInputTokens = 0;
    }
  }

  // Accounted Total Tokens
  const accountedTotalTokens = uncachedInputTokens + cachedInputTokens + cacheWriteTokens + outputTokens;

  if (reportedTotalTokens !== null && Math.abs(reportedTotalTokens - accountedTotalTokens) > 5) {
    anomalies.push(`total_tokens_mismatch:reported_${reportedTotalTokens}_vs_accounted_${accountedTotalTokens}`);
  }

  return {
    usageSchema,
    uncachedInputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    outputTokens,
    reasoningTokens,
    reportedTotalTokens,
    accountedTotalTokens,
    apiCallCount,
    toolCallCount,
    childSessionCount,
    cacheWriteIncludedInInput: "unknown",
    reasoningIncludedInOutput: "unknown",
    anomalies,
    rawUsageKeys
  };
}
