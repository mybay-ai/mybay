import { describe, expect, it } from "vitest";
import { createLocalRunUsage, readLocalRunUsage, usageWithReportedModel } from "./localRunUsage";

describe("local usage evidence", () => {
  it("preserves missing, zero and reported totals without double counting cache", () => {
    expect(createLocalRunUsage(null).totalTokens).toBeNull();
    const usage = createLocalRunUsage({ prompt_tokens: 100, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 80 }, total_tokens: 100 });
    expect(usage).toMatchObject({ inputTokens: 100, outputTokens: 0, totalTokens: 100, cacheReadTokens: 80, cacheWriteTokens: null, modelCalls: null, scope: "unknown" });
    expect(createLocalRunUsage({ input_tokens: 100, output_tokens: 5 }).totalTokens).toBeNull();
  });
  it.each([null, false, "42", -1, Infinity, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid numeric evidence %s", value => {
    expect(createLocalRunUsage({ total_tokens: value }, { durationMs: value })).toMatchObject({ totalTokens: null, durationMs: null });
  });
  it("retains explicit session scope and only reported model identity", () => {
    expect(createLocalRunUsage({ scope: "session", api_calls: 0, total_tokens: 100 })).toMatchObject({ counter: "snapshot", scope: "session", modelCalls: 0 });
    expect(createLocalRunUsage(usageWithReportedModel({}, "actual-model" )).model).toBe("actual-model");
    expect(createLocalRunUsage({ model: "sk-private", configuredModel: "configured" }).model).toBeNull();
  });
  it("rebuilds an allowlist and never retains prompt/key payloads", () => {
    const raw = { ...createLocalRunUsage({ total_tokens: 3 }), prompt: "PRIVATE", apiKey: "PRIVATE" };
    expect(JSON.stringify(readLocalRunUsage(raw))).not.toContain("PRIVATE");
    expect(readLocalRunUsage({ version: 2 })).toBeNull();
  });
});
