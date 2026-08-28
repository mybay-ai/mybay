import type { AgentInstance } from "../../types";
import type { ChatReadinessState } from "./chatReadinessState";

export function resolveInitialChatInstanceId(
  instances: AgentInstance[],
  readiness: Record<string, ChatReadinessState>,
  preferredInstanceId?: string | null,
) {
  const preferred = preferredInstanceId
    ? instances.find((instance) => instance.id === preferredInstanceId && readiness[instance.id]?.ready)
    : undefined;
  if (preferred) return preferred.id;
  return instances.find((instance) => readiness[instance.id]?.ready)?.id || instances[0]?.id || "";
}
