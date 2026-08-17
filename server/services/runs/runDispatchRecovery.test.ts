import { describe, expect, it } from "vitest";
import {
  findRecoveredUpstreamId,
  hasReachedDispatchAttemptLimit,
  isValidUpstreamRunId,
  normalizeDispatchError,
  resolveStopRecoveryWindow,
  shouldSearchForDispatchedRun,
} from "./runDispatchRecovery";

describe("run dispatch recovery decisions", () => {
  it.each([
    [[{ id: "upstream-1", run_id: "local-1" }], "upstream-1"],
    [{ runs: [{ id: "upstream-1", upstream_run_id: "local-1" }] }, "upstream-1"],
    [{ data: [{ id: "upstream-1" }, { id: "upstream-2", run_id: "local-1" }] }, "upstream-2"],
  ])("finds a recovered upstream id across supported list envelopes", (payload, expected) => {
    expect(findRecoveredUpstreamId(payload, "local-1")).toBe(expected);
  });

  it("requires the matching recovery record to expose an id", () => {
    expect(findRecoveredUpstreamId({ runs: [{ run_id: "local-1" }] }, "local-1")).toBeNull();
    expect(findRecoveredUpstreamId({ items: [{ id: "upstream-1", run_id: "local-1" }] }, "local-1")).toBeNull();
  });

  it("preserves the upstream id whitelist", () => {
    expect(isValidUpstreamRunId("run_1-safe.value")).toBe(true);
    expect(isValidUpstreamRunId("bad/id")).toBe(false);
    expect(isValidUpstreamRunId(42)).toBe(false);
  });

  it("searches only after the first dispatch and fails at the third attempt", () => {
    expect(shouldSearchForDispatchedRun(1)).toBe(false);
    expect(shouldSearchForDispatchedRun(2)).toBe(true);
    expect(hasReachedDispatchAttemptLimit(2)).toBe(false);
    expect(hasReachedDispatchAttemptLimit(3)).toBe(true);
  });

  it("keeps the stopping recovery timeout strict at more than 300 seconds", () => {
    const requestedAt = "2026-08-17T00:00:00.000Z";
    expect(resolveStopRecoveryWindow(2, requestedAt, Date.parse("2026-08-17T00:05:00.000Z")).timedOut).toBe(false);
    expect(resolveStopRecoveryWindow(2, requestedAt, Date.parse("2026-08-17T00:05:00.001Z")).timedOut).toBe(true);
    expect(resolveStopRecoveryWindow(3, requestedAt, Date.parse("2026-08-17T00:01:00.000Z")).timedOut).toBe(true);
  });

  it("preserves dispatch error normalization", () => {
    expect(normalizeDispatchError(401, "denied")).toBe("HERMES_API_AUTH_FAILED");
    expect(normalizeDispatchError(404, "missing")).toBe("DISPATCH_ROUTE_NOT_FOUND");
    expect(normalizeDispatchError(504, "timeout")).toBe("DISPATCH_TIMEOUT");
    expect(normalizeDispatchError(422, "invalid")).toBe("DISPATCH_INVALID_REQUEST");
    expect(normalizeDispatchError(503, "unavailable")).toBe("DISPATCH_UPSTREAM_UNAVAILABLE");
    expect(normalizeDispatchError(409, "other")).toBe("UPSTREAM_DISPATCH_ERR");
  });
});
