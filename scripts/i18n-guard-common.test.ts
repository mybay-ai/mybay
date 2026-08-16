import { describe, expect, it } from "vitest";
import { findNewIssues, summarizeIssues } from "./i18n-guard-common.mjs";

const issue = (fingerprint: string) => ({ fingerprint, relativePath: "src/Test.tsx", line: 1, rule: "jsx-text", text: fingerprint });

describe("i18n incremental baseline", () => {
  it("allows only the reviewed count and rejects added duplicates", () => {
    const current = [issue("same"), issue("same")];
    const baseline = [{ fingerprint: "same", count: 1 }];
    expect(findNewIssues(current, baseline)).toEqual([current[1]]);
  });

  it("stores stable sorted fingerprint counts", () => {
    expect(summarizeIssues([issue("b"), issue("a"), issue("b")])).toEqual([
      { fingerprint: "a", count: 1 },
      { fingerprint: "b", count: 2 },
    ]);
  });
});