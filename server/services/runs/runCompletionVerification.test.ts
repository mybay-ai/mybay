import { describe, expect, it } from "vitest";
import { assertVerifiedRunCompletionV1, verifyRunCompletionV1 } from "./runCompletionVerification";

const now = Date.now();
const run = {
  id: "run-1",
  status: "running",
  request_id: "request-1",
  upstream_run_id: "upstream-1",
  reconciled_by: "owner-1",
  lease_expires_at: new Date(now + 60_000).toISOString(),
};

describe("run completion verification", () => {
  it("verifies exact upstream evidence and binds the answer digest", () => {
    const decision = verifyRunCompletionV1(run, {
      source: "runtime_status",
      runId: "run-1",
      upstreamRunId: "upstream-1",
      assistantContent: "done",
      observedAtMs: now,
    }, "owner-1", now);
    expect(decision.verified).toBe(true);
    if (!decision.verified) return;
    expect(assertVerifiedRunCompletionV1(decision.verification, "run-1", "done").source).toBe("runtime_status");
    expect(() => assertVerifiedRunCompletionV1(decision.verification, "run-1", "changed")).toThrow("RUN_COMPLETION_VERIFICATION_REQUIRED");
  });

  it("fails closed for a mismatched binding, lost lease, or empty answer", () => {
    expect(verifyRunCompletionV1(run, {
      source: "runtime_status", runId: "run-1", upstreamRunId: "wrong", assistantContent: "done", observedAtMs: now,
    }, "owner-1", now)).toMatchObject({ verified: false, reason: "RUN_COMPLETION_UPSTREAM_BINDING_MISMATCH" });
    expect(verifyRunCompletionV1(run, {
      source: "runtime_response", runId: "run-1", requestId: "request-1", responseStatusCode: 200, assistantContent: "done", observedAtMs: now,
    }, "wrong-owner", now)).toMatchObject({ verified: false, reason: "RUN_COMPLETION_LEASE_INVALID" });
    expect(verifyRunCompletionV1(run, {
      source: "runtime_status", runId: "run-1", upstreamRunId: "upstream-1", assistantContent: " ", observedAtMs: now,
    }, "owner-1", now)).toMatchObject({ verified: false, reason: "RUN_COMPLETION_EMPTY_ASSISTANT_CONTENT" });
  });
});
