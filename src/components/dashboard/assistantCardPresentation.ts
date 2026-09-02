import type { AgentInstance } from "../../types";

export type AssistantCardIssue = "deployment" | "model" | "state" | "runtime";

export function getAssistantCardIssue(instance: AgentInstance): AssistantCardIssue | null {
  if (instance.archived || instance.status === "deleting") return null;
  if (instance.deployment_error || ["failed", "cleanup_failed"].includes(instance.status)) return "deployment";
  if (["failed", "mismatched"].includes(instance.model_config_status || "")) return "model";
  if (instance.physical_error) return "state";
  if (["partial_running", "unhealthy", "frontend_missing_build"].includes(instance.status)) return "runtime";
  return null;
}

export function getAssistantCardPresentation(instance: AgentInstance, pending = false) {
  const inactive = pending || !!instance.archived || instance.status === "deleting";
  const chatReadyStatus = ["running", "gateway_ready", "dashboard_ready"].includes(instance.status);
  const issue = getAssistantCardIssue(instance);

  return {
    canChat: !inactive && chatReadyStatus && issue === null,
    canOpenFiles: !pending && instance.status !== "deleting",
    issue,
    needsAttention: issue !== null,
  };
}
