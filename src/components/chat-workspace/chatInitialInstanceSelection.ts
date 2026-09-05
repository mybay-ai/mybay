import type { AgentInstance } from "../../types";
import type { ChatReadinessState } from "./chatReadinessState";

export function resolveInitialChatInstanceId(
  instances: AgentInstance[],
  readiness: Record<string, ChatReadinessState>,
  preferredInstanceId?: string | null,
  rememberedInstanceId?: string | null,
) {
  // Readiness gates new work, not access to a remembered conversation's history.
  const preferred = preferredInstanceId
    ? instances.find((instance) => instance.id === preferredInstanceId)
    : undefined;
  if (preferred) return preferred.id;
  const remembered = instances.find(instance => instance.id === rememberedInstanceId);
  if (remembered) return remembered.id;
  return instances.find((instance) => readiness[instance.id]?.ready)?.id || instances[0]?.id || "";
}
