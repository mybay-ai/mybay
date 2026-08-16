import type { ChatToolStep } from "./ChatToolProgress";
import type { ChatRunMetrics } from "./useChatRuns";

export type TerminalRunStatus = "completed" | "failed" | "cancelled" | "stopped" | "expired";

export function isTerminalRunStatus(status: unknown): status is TerminalRunStatus {
  return ["completed", "failed", "cancelled", "stopped", "expired"].includes(String(status));
}

export function parseTimeMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 && value < 100000000000 ? value * 1000 : value;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric > 0 && numeric < 100000000000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeRunDurationMs(source: any): number | null {
  const durationMs = source?.durationMs ?? source?.duration_ms;
  if (typeof durationMs === "number" && Number.isFinite(durationMs)) return Math.max(0, durationMs);
  const durationSeconds = source?.duration;
  if (typeof durationSeconds === "number" && Number.isFinite(durationSeconds)) return Math.max(0, durationSeconds * 1000);
  const startedAt = parseTimeMs(source?.startedAt ?? source?.started_at ?? source?.createdAt ?? source?.created_at);
  const completedAt = parseTimeMs(source?.completedAt ?? source?.completed_at ?? source?.finishedAt ?? source?.finished_at);
  if (startedAt !== null && completedAt !== null && completedAt >= startedAt) return completedAt - startedAt;
  return null;
}

export function shouldApplyRunUpdate(boundRunId: string | null | undefined, currentRunId: string | null | undefined) {
  return !boundRunId || !currentRunId || boundRunId === currentRunId;
}

export function isPollingGenerationCurrent(boundGeneration: number, currentGeneration: number) {
  return boundGeneration === currentGeneration;
}

export function canExecutePollingCallback(args: {
  boundRunId: string;
  currentRunId: string | null | undefined;
  boundGeneration: number;
  currentGeneration: number;
  aborted?: boolean;
}) {
  return !args.aborted
    && shouldApplyRunUpdate(args.boundRunId, args.currentRunId)
    && isPollingGenerationCurrent(args.boundGeneration, args.currentGeneration);
}

export function shouldTriggerFallback(args: {
  aborted?: boolean;
  terminal?: boolean;
  selectedInstanceId?: string | null;
  boundInstanceId?: string | null;
  selectedConversationId?: string | null;
  boundConversationId?: string | null;
}) {
  return !args.aborted
    && !args.terminal
    && !!args.selectedInstanceId
    && args.selectedInstanceId === args.boundInstanceId
    && !!args.selectedConversationId
    && args.selectedConversationId === args.boundConversationId;
}

export function shouldRenderRunDetails(runMetrics: ChatRunMetrics | null | undefined) {
  return Boolean(runMetrics?.status && isTerminalRunStatus(runMetrics.status));
}

export function shouldScheduleAutoCollapse(runMetrics: ChatRunMetrics | null | undefined) {
  return shouldRenderRunDetails(runMetrics);
}

export function finalizeRunSteps(steps: ChatToolStep[], terminalStatus: TerminalRunStatus): ChatToolStep[] {
  const finalStepStatus = terminalStatus === "completed" ? "completed" : "failed";
  const completedAt = Date.now();
  return steps.map((step) => {
    if (step.status !== "running") return step;
    return {
      ...step,
      status: finalStepStatus,
      completedAt: step.completedAt || completedAt
    };
  });
}

export function finalizeRunMetrics(
  runId: string | null,
  source: Partial<ChatRunMetrics> | any,
  terminalStatus: TerminalRunStatus
): ChatRunMetrics {
  const startedAt = source?.startedAt ?? source?.started_at ?? null;
  const completedAt = source?.completedAt ?? source?.completed_at ?? Date.now();
  return {
    ...source,
    runId: runId || source?.runId || source?.run_id || null,
    status: terminalStatus,
    durationMs: normalizeRunDurationMs({ ...source, startedAt, completedAt }),
    startedAt,
    completedAt
  };
}
