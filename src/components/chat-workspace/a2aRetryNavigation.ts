export const A2A_RETRY_DRAFT_MAX_CHARS = 4_000;

export type A2ARetryNavigationState = {
  a2aRetryDraft: string;
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
  return { a2aRetryDraft: draft, a2aRetryInstanceId: instanceId };
}

export function isRetryableA2AStatus(status: string): boolean {
  return ["connection_failed", "timed_out", "agent_offline", "failed"].includes(status);
}
