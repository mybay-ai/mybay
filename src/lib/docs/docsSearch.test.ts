import { describe, expect, it } from "vitest";
import type { DocsSearchRecord } from "./docsTypes";
import { rankDocsSearch, scoreDocsSearchRecord } from "./docsSearch";

function record(overrides: Partial<DocsSearchRecord>): DocsSearchRecord {
  return {
    id: "example",
    locale: "en",
    title: "Example",
    description: "",
    keywords: [],
    headings: [],
    content: "",
    href: "/docs/example",
    ...overrides,
  };
}

describe("docs search ranking", () => {
  it("weights title matches above body-only matches", () => {
    const titleMatch = record({ id: "title", title: "API key setup" });
    const bodyMatch = record({ id: "body", title: "Credentials", content: "Set up an API key here" });
    expect(scoreDocsSearchRecord(titleMatch, "API key"))
      .toBeGreaterThan(scoreDocsSearchRecord(bodyMatch, "API key"));
  });

  it("supports multiple tokens, filters misses, and enforces the result limit", () => {
    const records = [
      record({ id: "best", title: "Runtime model update", keywords: ["hot update"] }),
      record({ id: "body", title: "Models", content: "runtime model update" }),
      record({ id: "miss", title: "Instance logs" }),
    ];
    expect(rankDocsSearch(records, "runtime update", 1).map(result => result.record.id)).toEqual(["best"]);
  });
});
