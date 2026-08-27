import { isTerminalRunStatus } from "../runUiLifecycle";

export const RUN_TERMINAL_WATCHDOG_INTERVAL_MS = 20_000;
export const RUN_FINAL_STEP_RECHECK_DELAY_MS = 3_000;
export const RUN_TERMINAL_WATCHDOG_UNKNOWN_THRESHOLD = 3;

export function isFinalStepTerminalHint(step: any): boolean {
  const status = String(step?.status || "").toLowerCase();
  const type = String(step?.stepType || step?.step_type || "").toLowerCase();
  const finalIdentity = type === "final" || String(step?.id || "").toLowerCase().includes("-final");
  return finalIdentity && (status === "completed" || status === "failed");
}

export function canApplyTerminalWatchdogResponse(params: {
  requestGeneration: number;
  currentGeneration: number;
  targetRunId: string;
  currentRunId: string | null;
  instanceId: string;
  currentInstanceId: string;
  conversationId: string;
  currentConversationId: string | null;
}): boolean {
  return params.requestGeneration === params.currentGeneration
    && params.targetRunId === params.currentRunId
    && params.instanceId === params.currentInstanceId
    && params.conversationId === params.currentConversationId;
}

export function readAuthoritativeTerminalStatus(run: any) {
  return isTerminalRunStatus(run?.status) ? run.status : null;
}

export function shouldPublishWatchdogStatusUnknown(failures: number): boolean {
  return Number.isFinite(failures) && failures >= RUN_TERMINAL_WATCHDOG_UNKNOWN_THRESHOLD;
}

export function shouldRunTerminalWatchdog(fallbackPollingActive: boolean): boolean {
  return !fallbackPollingActive;
}
