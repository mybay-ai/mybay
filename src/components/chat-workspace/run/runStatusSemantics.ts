import type { ChatToolStepStatus } from "../ChatToolProgress";
import type { RunExecutionStatus } from "./runTypes";

export type RunDisplayStatus =
  | "idle"
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "stopping"
  | "completed"
  | "failed"
  | "stopped"
  | "unknown";

export type ToolDisplayStatus = "running" | "waiting_for_approval" | "completed" | "failed" | "stopped" | "unknown";

const TERMINAL_DISPLAY_STATUSES = new Set<RunDisplayStatus>(["completed", "failed", "stopped"]);

export function normalizeRunDisplayStatus(value: unknown): RunDisplayStatus {
  const status = String(value || "").trim().toLowerCase();
  if (!status) return "idle";
  if (status === "queued" || status === "pending") return "queued";
  if (["running", "dispatching", "started"].includes(status)) return "running";
  if (["waiting_for_approval", "approval_required"].includes(status)) return "waiting_for_approval";
  if (["stopping", "stop_requested"].includes(status)) return "stopping";
  if (status === "completed" || status === "success" || status === "succeeded") return "completed";
  if (["cancelled", "canceled", "stopped"].includes(status)) return "stopped";
  if (["failed", "error", "expired"].includes(status)) return "failed";
  if (status === "status_unknown" || status === "unknown") return "unknown";
  return "unknown";
}

export function isTerminalRunDisplayStatus(status: RunDisplayStatus): boolean {
  return TERMINAL_DISPLAY_STATUSES.has(status);
}

export function reconcileRunMetricStatus(previous: unknown, incoming: unknown): string | null {
  const previousDisplay = normalizeRunDisplayStatus(previous);
  const incomingDisplay = normalizeRunDisplayStatus(incoming);
  if (incomingDisplay === "idle") return previousDisplay === "idle" ? null : String(previous);
  if (isTerminalRunDisplayStatus(previousDisplay)) return String(previous);
  return String(incoming);
}

export function resolveRunDisplayStatus(args: {
  activeRunId?: string | null;
  executionRunId?: string | null;
  executionStatus?: RunExecutionStatus | string | null;
  metricRunId?: string | null;
  metricStatus?: string | null;
  hasPendingApproval?: boolean;
  hasRunningTool?: boolean;
}): RunDisplayStatus {
  const executionMatches = Boolean(args.executionStatus) && (!args.activeRunId || !args.executionRunId || args.executionRunId === args.activeRunId);
  const metricMatches = Boolean(args.metricStatus) && (!args.activeRunId || !args.metricRunId || args.metricRunId === args.activeRunId);
  const execution = executionMatches ? normalizeRunDisplayStatus(args.executionStatus) : "idle";
  const metric = metricMatches ? normalizeRunDisplayStatus(args.metricStatus) : "idle";

  if (isTerminalRunDisplayStatus(execution)) return execution;
  if (isTerminalRunDisplayStatus(metric)) return metric;
  if (args.hasPendingApproval || execution === "waiting_for_approval" || metric === "waiting_for_approval") return "waiting_for_approval";
  if (execution === "stopping" || metric === "stopping") return "stopping";
  if (execution === "queued" || metric === "queued") return "queued";
  if (execution === "unknown" || metric === "unknown") return "unknown";
  if (args.activeRunId || args.hasRunningTool || execution === "running" || metric === "running") return "running";
  return "idle";
}

export function resolveToolDisplayStatus(toolStatus: ChatToolStepStatus, runStatus: RunDisplayStatus, completionInferred = false): ToolDisplayStatus {
  if (completionInferred) return runStatus === "stopped" ? "stopped" : "unknown";
  if (toolStatus === "completed") return "completed";
  if (toolStatus === "failed") return "failed";
  if (runStatus === "waiting_for_approval") return "waiting_for_approval";
  if (runStatus === "stopped") return "stopped";
  if (runStatus === "failed") return "failed";
  return "running";
}

export function getRunStatusI18nKey(status: RunDisplayStatus): string {
  return {
    idle: "runStatusIdle",
    queued: "runStatusQueued",
    running: "runStatusRunning",
    waiting_for_approval: "runStatusWaitingForApproval",
    stopping: "runStatusStopping",
    completed: "runStatusCompleted",
    failed: "runStatusFailed",
    stopped: "runStatusStopped",
    unknown: "runStatusUnknown"
  }[status];
}

export function getToolStatusI18nKey(status: ToolDisplayStatus): string {
  return {
    running: "toolRunning",
    waiting_for_approval: "toolWaitingForApproval",
    completed: "toolCompleted",
    failed: "toolFailed",
    stopped: "toolStopped",
    unknown: "toolResultUnknown"
  }[status];
}
