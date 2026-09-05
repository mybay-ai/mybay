import { readA2ARecoverySource, type A2ARecoverySource } from "../../../shared/a2aRecovery";
export const A2A_RETRY_DRAFT_MAX_CHARS = 4_000;

export type A2ARetryNavigationState = {
  a2aRetryDraft: string;
  a2aRecoverySource?: A2ARecoverySource;
  a2aRetryInstanceId: string;
};

export function readA2ARetryNavigationState(
  value: unknown,
  selectedInstanceId: string,
): A2ARetryNavigationState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const draft = typeof candidate.a2aRetryDraft === "string" ? candidate.a2aRetryDraft.trim() : "";
  const instanceId = typeof candidate.a2aRetryInstanceId === "string" ? candidate.a2aRetryInstanceId.trim() : "";
  if (!draft || !instanceId || instanceId !== selectedInstanceId || draft.length > A2A_RETRY_DRAFT_MAX_CHARS) return null;
  const source = readA2ARecoverySource(candidate.a2aRecoverySource);
  return { a2aRetryDraft: draft, a2aRetryInstanceId: instanceId, ...(source ? { a2aRecoverySource: source } : {}) };
}

export function isRetryableA2AStatus(status: string): boolean {
  return ["connection_failed", "timed_out", "agent_offline", "failed"].includes(status);
}

export function canReviewA2ARecovery(activity: { direction: string; peerId: string | null; status: string }): boolean {
  return activity.direction === "outbound" && Boolean(activity.peerId)
    && ["connection_failed", "timed_out", "agent_offline", "failed", "auth_failed", "unknown"].includes(activity.status);
}

export function a2aRecoveryReason(status: string): "check_result" | "check_auth" | "check_service" {
  if (["timed_out", "unknown", "failed"].includes(status)) return "check_result";
  return status === "auth_failed" ? "check_auth" : "check_service";
}
