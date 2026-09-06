import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createLocalRunUsage } from "../../../shared/localRunUsage";
import { ConversationContextStatus, getContextCompactionRecommendation, resolveDisplayedContext } from "./ConversationContextStatus";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => `${key}${options?.percent === undefined ? "" : `:${options.percent}`}` }) }));

describe("conversation context status", () => {
  it("shows a compact conversation-level trigger below the composer", () => {
    const usage = createLocalRunUsage({ context_tokens: 9993, context_window: 1_000_000, context_percent: 1 });
    const html = renderToStaticMarkup(<ConversationContextStatus usage={usage} instanceId="instance-1" conversationId="conversation-1" />);
    expect(html).toContain("usage.contextCompactLabel:1");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain("usage.compactNow");
  });

  it("keeps missing Runtime context evidence truthful", () => {
    const html = renderToStaticMarkup(<ConversationContextStatus usage={null} instanceId="instance-1" conversationId="conversation-1" />);
    expect(html).toContain("usage.contextUnknown");
  });

  it("uses a successful manual compaction estimate until the next terminal report", () => {
    const usage = createLocalRunUsage({ context_tokens: 80_000, context_window: 100_000, context_percent: 80 });
    expect(resolveDisplayedContext(usage, { status: "completed", runtime: "pi", tokensBefore: 80_000, estimatedTokensAfter: 20_000 })).toEqual({
      tokens: 20_000,
      window: 100_000,
      percent: 20,
      estimated: true,
    });
  });

  it("uses context thresholds to explain whether manual compaction is useful", () => {
    expect(getContextCompactionRecommendation(null)).toBe("unknown");
    expect(getContextCompactionRecommendation(1)).toBe("low");
    expect(getContextCompactionRecommendation(70)).toBe("recommended");
    expect(getContextCompactionRecommendation(85)).toBe("urgent");
  });
});
