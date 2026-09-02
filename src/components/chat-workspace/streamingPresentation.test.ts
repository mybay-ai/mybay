import { describe, expect, it } from "vitest";
import { resolveTextFlushDelay, STEADY_TEXT_FLUSH_DELAY_MS } from "./streamingPresentation";

describe("streaming text presentation", () => {
  it("renders the first text delta immediately", () => {
    expect(resolveTextFlushDelay(false)).toBe(0);
  });

  it("batches later text deltas with a short steady-state delay", () => {
    expect(resolveTextFlushDelay(true)).toBe(STEADY_TEXT_FLUSH_DELAY_MS);
    expect(STEADY_TEXT_FLUSH_DELAY_MS).toBeLessThan(120);
  });
});
