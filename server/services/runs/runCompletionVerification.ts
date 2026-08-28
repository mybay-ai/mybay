import crypto from "crypto";
import { containsDsmlToolCallProtocol } from "../../utils/dsmlToolCallGuard";
import { hasValidRunLease } from "./runLease";

const VERIFIED_RUN_COMPLETION_V1 = Symbol("VerifiedRunCompletionV1");

type CompletionClaimBase = {
  runId: string;
  assistantContent: string;
  observedAtMs: number;
};

export type RunCompletionClaimV1 =
  | (CompletionClaimBase & { source: "runtime_status"; upstreamRunId: string })
  | (CompletionClaimBase & { source: "runtime_response"; requestId: string; responseStatusCode: number });

export type RunCompletionVerificationAuditV1 = {
  schemaVersion: "mybay.run-completion-verification.v1";
  runId: string;
  runtimeType: "hermes";
  source: RunCompletionClaimV1["source"];
  verifiedAt: string;
  assistantContentSha256: string;
  evidence: { upstreamRunId?: string; requestId?: string; responseStatusCode?: number };
};

export type VerifiedRunCompletionV1 = {
  readonly [VERIFIED_RUN_COMPLETION_V1]: true;
  readonly runId: string;
  readonly assistantContentSha256: string;
  readonly audit: RunCompletionVerificationAuditV1;
};

export type RunCompletionVerificationDecisionV1 =
  | { verified: true; verification: VerifiedRunCompletionV1 }
  | { verified: false; reason: string };

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function verifyRunCompletionV1(
  run: any,
  claim: RunCompletionClaimV1,
  ownerId: string,
  nowMs: number = Date.now(),
): RunCompletionVerificationDecisionV1 {
  if (!run || String(run.id || "") !== claim.runId) return { verified: false, reason: "RUN_COMPLETION_RUN_NOT_FOUND" };
  if (!Number.isFinite(claim.observedAtMs) || claim.observedAtMs <= 0 || claim.observedAtMs > nowMs + 300_000) {
    return { verified: false, reason: "RUN_COMPLETION_INVALID_OBSERVATION_TIME" };
  }
  if (!claim.assistantContent.trim()) return { verified: false, reason: "RUN_COMPLETION_EMPTY_ASSISTANT_CONTENT" };
  if (containsDsmlToolCallProtocol(claim.assistantContent)) return { verified: false, reason: "RUN_COMPLETION_UNSAFE_ASSISTANT_CONTENT" };
  if (!["queued", "running", "stopping", "completed"].includes(String(run.status || ""))) {
    return { verified: false, reason: "RUN_COMPLETION_INVALID_STATE" };
  }
  if (claim.source === "runtime_response" && run.status !== "completed" && !hasValidRunLease(run, ownerId, nowMs)) {
    return { verified: false, reason: "RUN_COMPLETION_LEASE_INVALID" };
  }

  const evidence: RunCompletionVerificationAuditV1["evidence"] = {};
  if (claim.source === "runtime_status") {
    if (!claim.upstreamRunId || String(run.upstream_run_id || "") !== claim.upstreamRunId) {
      return { verified: false, reason: "RUN_COMPLETION_UPSTREAM_BINDING_MISMATCH" };
    }
    evidence.upstreamRunId = claim.upstreamRunId;
  } else {
    if (!claim.requestId || String(run.request_id || "") !== claim.requestId) {
      return { verified: false, reason: "RUN_COMPLETION_REQUEST_BINDING_MISMATCH" };
    }
    if (!Number.isInteger(claim.responseStatusCode) || claim.responseStatusCode < 200 || claim.responseStatusCode >= 300) {
      return { verified: false, reason: "RUN_COMPLETION_TRANSPORT_REJECTED" };
    }
    evidence.requestId = claim.requestId;
    evidence.responseStatusCode = claim.responseStatusCode;
  }

  const assistantContentSha256 = sha256(claim.assistantContent);
  const audit: RunCompletionVerificationAuditV1 = Object.freeze({
    schemaVersion: "mybay.run-completion-verification.v1",
    runId: claim.runId,
    runtimeType: "hermes",
    source: claim.source,
    verifiedAt: new Date(nowMs).toISOString(),
    assistantContentSha256,
    evidence: Object.freeze(evidence),
  });
  return {
    verified: true,
    verification: Object.freeze({
      [VERIFIED_RUN_COMPLETION_V1]: true as const,
      runId: claim.runId,
      assistantContentSha256,
      audit,
    }),
  };
}

export function assertVerifiedRunCompletionV1(
  verification: VerifiedRunCompletionV1 | undefined,
  runId: string,
  assistantContent: string,
): RunCompletionVerificationAuditV1 {
  if (!verification
    || verification[VERIFIED_RUN_COMPLETION_V1] !== true
    || verification.runId !== runId
    || verification.assistantContentSha256 !== sha256(assistantContent)) {
    throw Object.assign(new Error("RUN_COMPLETION_VERIFICATION_REQUIRED"), { code: "RUN_COMPLETION_VERIFICATION_REQUIRED" });
  }
  return verification.audit;
}
