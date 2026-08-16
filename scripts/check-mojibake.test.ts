import { describe, expect, it } from "vitest";
import { findMojibakeIssues } from "./check-mojibake.mjs";

describe("mojibake scanner", () => {
  it("accepts valid Chinese, English, em dashes and smart quotes", () => {
    expect(findMojibakeIssues("中文\nEnglish\n—\n“quotes”")).toEqual([]);
  });

  it("detects typical UTF-8 decoded as Latin-1 sequences", () => {
    const invalid = [
      "\u00e2\u0080\u0094",
      "\u00e2\u0080\u0099",
      "\u00c3\u00a9"
    ].join("\n");
    expect(findMojibakeIssues(invalid)).toHaveLength(3);
  });
});
