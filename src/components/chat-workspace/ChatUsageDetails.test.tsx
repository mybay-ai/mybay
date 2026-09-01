import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createLocalRunUsage } from "../../../shared/localRunUsage";
import { createConfiguredModelEvidence } from "../../../shared/localModelEvidence";
import { ChatUsageDetails, getUsagePresentation } from "./ChatUsageDetails";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe("usage presentation", () => {
  it("shows unknown legacy cache/model and does not infer total from partial fields", () => {
    const html = renderToStaticMarkup(<ChatUsageDetails message={{ usage_prompt_tokens: 32, metadata: { model: "CONFIGURED_ONLY" } }} />);
    expect(html).toContain("usage.unknown");
    expect(html).not.toContain("CONFIGURED_ONLY");
    expect(html).toContain("sources.legacy");
  });
  it("preserves explicit zero and session scope", () => {
    const html = renderToStaticMarkup(<ChatUsageDetails message={{ metadata: { usage_evidence: createLocalRunUsage({ scope: "session", api_calls: 0, total_tokens: 0 }) } }} />);
    expect(html).toMatch(/>0<\/dd>/);
    expect(html).toContain("scopes.session");
  });
  it("calculates a reported cache hit for the compact footer summary", () => {
    const presentation = getUsagePresentation({ metadata: { usage_evidence: createLocalRunUsage({ input_tokens: 1_000, cache_read_tokens: 640 }) } });
    expect(presentation.state).toBe("hit");
    expect(presentation.hitRate).toBe(64);
    const html = renderToStaticMarkup(<ChatUsageDetails message={{ metadata: { usage_evidence: presentation.usage } }} />);
    expect(html).toContain("usage.cacheHit");
    expect(html).toContain('role="dialog"');
  });
  it("shows the model configuration captured for a task separately from the reported model", () => {
    const html = renderToStaticMarkup(<ChatUsageDetails message={{ metadata: {
      model_evidence: createConfiguredModelEvidence("deepseek-v4-flash")!,
    } }} />);
    expect(html).toContain("usage.configuredModel");
    expect(html).toContain("deepseek-v4-flash");
  });
});
