import { describe, expect, it } from "vitest";
import { chooseMostCompleteStreamingContent, mergeRecoveredStreamingContent } from "./runTextReconciliation";

describe("chooseMostCompleteStreamingContent", () => {
  it("keeps a longer current stream when a stale snapshot arrives", () => {
    expect(chooseMostCompleteStreamingContent("hello world", "hello")).toBe("hello world");
  });

  it("accepts a more complete authoritative snapshot", () => {
    expect(chooseMostCompleteStreamingContent("hello", "hello world")).toBe("hello world");
  });

  it("does not concatenate an already accumulated stream snapshot", () => {
    expect(chooseMostCompleteStreamingContent("hello", "hello")).toBe("hello");
  });

  it("uses normalized completeness for ellipsis variants", () => {
    expect(chooseMostCompleteStreamingContent("thinking...", "thinking… done")).toBe("thinking… done");
  });
});


describe("mergeRecoveredStreamingContent", () => {
  it("does not duplicate a baseline while replay catches up from the beginning", () => {
    expect(mergeRecoveredStreamingContent("hello", "hel")).toBe("hello");
    expect(mergeRecoveredStreamingContent("hello", "hello world")).toBe("hello world");
  });

  it("appends replayed deltas when the server cache starts after the baseline", () => {
    expect(mergeRecoveredStreamingContent("hello", " world")).toBe("hello world");
  });
});
