import { describe, expect, it } from "vitest";
import {
  extractUpstreamErrorCode,
  isFallbackHermesSessionId,
  isStaleSessionError,
  shouldFallbackSessionCreate
} from "./runHermesProtocol";

describe("Hermes protocol policy", () => {
  it("extracts normalized codes from nested and serialized upstream errors", () => {
    expect(extractUpstreamErrorCode({ error: '{"error_code":"session_not_found"}' }))
      .toBe("SESSION_NOT_FOUND");
    expect(extractUpstreamErrorCode({ detail: { code: "worker_upstream_error" } }))
      .toBe("WORKER_UPSTREAM_ERROR");
  });

  it("preserves session-create fallback and stale-session boundaries", () => {
    expect(shouldFallbackSessionCreate(404)).toBe(true);
    expect(shouldFallbackSessionCreate(403, { code: "UNAUTHORIZED" })).toBe(true);
    expect(shouldFallbackSessionCreate(500, { code: "TIMEOUT" })).toBe(false);
    expect(isStaleSessionError(410, { error_code: "SESSION_EXPIRED" })).toBe(true);
    expect(isStaleSessionError(500, { error_code: "SESSION_EXPIRED" })).toBe(false);
  });

  it("recognizes only the stable conversation-derived fallback id", () => {
    expect(isFallbackHermesSessionId("mybay_abc123", "abc-123")).toBe(true);
    expect(isFallbackHermesSessionId("conv_abc123", "abc-123")).toBe(false);
  });
});

