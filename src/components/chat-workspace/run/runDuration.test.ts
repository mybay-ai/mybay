import { describe, expect, it } from "vitest";
import { normalizeRunTimestampMs, resolveRunDurationMs } from "./runDuration";

const now = Date.UTC(2026, 7, 17, 2, 30, 0);

describe("run duration", () => {
  it("calculates a live duration from the authoritative run start", () => {
    expect(resolveRunDurationMs({
      metrics: { startedAt: now - 12_000 },
      startCandidates: [1234],
      active: true,
      nowMs: now
    })).toBe(12_000);
  });

  it("rejects relative timestamps that would be interpreted as 1970", () => {
    expect(normalizeRunTimestampMs(1234, now)).toBeNull();
    expect(resolveRunDurationMs({ startCandidates: [1234], active: true, nowMs: now })).toBeNull();
  });

  it("uses a plausible tool start when run metrics have no start", () => {
    expect(resolveRunDurationMs({ startCandidates: [now - 5000], active: true, nowMs: now })).toBe(5000);
  });

  it("prefers the authoritative terminal duration", () => {
    expect(resolveRunDurationMs({
      metrics: { durationMs: 4200, startedAt: now - 10_000, completedAt: now },
      active: false,
      nowMs: now
    })).toBe(4200);
  });

  it("derives a terminal duration only from plausible endpoints", () => {
    expect(resolveRunDurationMs({
      startCandidates: [now - 8000, 50],
      completedCandidates: [now - 1000],
      active: false,
      nowMs: now
    })).toBe(7000);
  });
});
