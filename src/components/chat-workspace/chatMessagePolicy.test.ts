import { describe, expect, it } from "vitest";
import {
  isConcurrencyTakeoverError,
  normalizeStoredMessageError,
  normalizeStoredMessageStatus
} from "./chatMessagePolicy";

describe("chat message policy characterization", () => {
  it("maps stopped and takeover failures to terminal UI statuses", () => {
    expect(normalizeStoredMessageStatus("cancelled", "RUN_STOPPED")).toBe("stopped");
    expect(normalizeStoredMessageStatus("failed", "ACTIVE_RUN_EXISTS")).toBe("superseded");
    expect(normalizeStoredMessageStatus(undefined, undefined)).toBe("completed");
  });

  it("suppresses stopped and takeover errors but preserves ordinary failures", () => {
    expect(normalizeStoredMessageError("failed", "RUN_CANCELLED", "cancelled")).toBeUndefined();
    expect(normalizeStoredMessageError("failed", "CONCURRENT_RUN", "busy")).toBeUndefined();
    expect(normalizeStoredMessageError("failed", "UPSTREAM_ERROR", "upstream failed")).toBe("upstream failed");
  });

  it("recognizes takeover responses from status, code, and message", () => {
    expect(isConcurrencyTakeoverError({ data: { error: "TOO_MANY_CONCURRENT_RUNS" } })).toBe(true);
    expect(isConcurrencyTakeoverError({ status: 409, code: "RUNNING" })).toBe(true);
    expect(isConcurrencyTakeoverError({ status: 429, data: { message: "active run exists" } })).toBe(true);
    expect(isConcurrencyTakeoverError({ status: 500, code: "RUNNING" })).toBe(false);
  });
});

