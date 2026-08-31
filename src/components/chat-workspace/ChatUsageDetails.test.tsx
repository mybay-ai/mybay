import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createLocalRunUsage } from "../../../shared/localRunUsage";
import { ChatUsageDetails } from "./ChatUsageDetails";
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
    expect(html).toContain(">0</dd>");
    expect(html).toContain("scopes.session");
  });
});
