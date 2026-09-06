import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createLocalRunUsage } from "../../../shared/localRunUsage";
import { ChatUsageDetails, getUsagePopoverPosition, getUsagePresentation, manualCompactionStateFromPayload } from "./ChatUsageDetails";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe("usage presentation", () => {
  it("shows unknown legacy cache/model and does not infer total from partial fields", () => {
    const presentation = getUsagePresentation({ usage_prompt_tokens: 32, metadata: { model: "CONFIGURED_ONLY" } });
    expect(presentation.usage.inputTokens).toBe(32);
    expect(presentation.usage.totalTokens).toBeNull();
    expect(presentation.usage.model).toBeNull();
    expect(presentation.usage.source).toBe("legacy");
  });
  it("preserves explicit zero and session scope", () => {
    const presentation = getUsagePresentation({ metadata: { usage_evidence: createLocalRunUsage({ scope: "session", api_calls: 0, total_tokens: 0 }) } });
    expect(presentation.usage.totalTokens).toBe(0);
    expect(presentation.usage.modelCalls).toBe(0);
    expect(presentation.usage.scope).toBe("session");
  });
  it("calculates a reported cache hit for the compact footer summary", () => {
    const presentation = getUsagePresentation({ metadata: { usage_evidence: createLocalRunUsage({ input_tokens: 1_000, cache_read_tokens: 640 }) } });
    expect(presentation.state).toBe("hit");
    expect(presentation.hitRate).toBe(64);
    const html = renderToStaticMarkup(<ChatUsageDetails message={{ metadata: { usage_evidence: presentation.usage } }} />);
    expect(html).toContain("usage.turnSummary");
    expect(html).toContain('aria-haspopup="dialog"');
  });
  it("shows Pi context pressure and verified compaction evidence", () => {
    const presentation = getUsagePresentation({ metadata: { usage_evidence: createLocalRunUsage({
      context_tokens: 90000,
      context_window: 128000,
      context_percent: 70.31,
      compaction_status: "completed",
      compaction_reason: "threshold",
      compaction_tokens_before: 111000,
      compaction_estimated_tokens_after: 24000,
    }) } });
    expect(presentation.usage.contextPercent).toBe(70.31);
    expect(presentation.usage.compactionStatus).toBe("completed");
    expect(presentation.usage.compactionTokensBefore).toBe(111000);
    expect(presentation.usage.compactionEstimatedTokensAfter).toBe(24000);
  });
  it("exposes the usage trigger as a controlled dialog button", () => {
    const html = renderToStaticMarkup(<ChatUsageDetails
      message={{ metadata: {} }}
    />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-haspopup="dialog"');
  });
  it("keeps a tall desktop panel inside the viewport and gives it an internal scroll area", () => {
    expect(getUsagePopoverPosition({ top: 520, right: 900, bottom: 544 }, 760, 1024, 700)).toEqual({
      left: 580,
      top: 12,
      width: 320,
      maxHeight: 500,
      mobile: false,
    });
  });
  it("uses a viewport-bounded bottom sheet on mobile", () => {
    expect(getUsagePopoverPosition({ top: 540, right: 360, bottom: 564 }, 900, 375, 667)).toEqual({
      left: 12,
      top: 12,
      width: 351,
      maxHeight: 643,
      mobile: true,
    });
  });
  it("preserves a structured Runtime no-op returned with HTTP 409", () => {
    expect(manualCompactionStateFromPayload({
      runtime: "pi",
      status: "aborted",
      tokensBefore: null,
      estimatedTokensAfter: null,
    })).toEqual({
      runtime: "pi",
      status: "aborted",
      tokensBefore: null,
      estimatedTokensAfter: null,
    });
  });
});
