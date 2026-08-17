import { containsDsmlToolCallProtocol, DSML_TOOL_CALL_ERROR_CODE } from "../../utils/dsmlToolCallGuard";
import { sanitizeStep } from "./runStepSanitizer";

export type RunTerminalStatus = "completed" | "failed" | "cancelled" | "expired";

export interface RunTerminalUsage {
  prompt_tokens?: number | null;
  input_tokens?: number | null;
  completion_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
  [key: string]: unknown;
}

export interface RunTerminalRecord {
  status?: string | null;
  error_code?: string | null;
  duration_ms?: number | null;
  user_id?: string | null;
  instance_id?: string | null;
  conversation_id?: string | null;
  [key: string]: unknown;
}

export interface FinishRunResult {
  status: string;
  assistant_message_id: string | null;
  assistant_sequence_no: number | null;
}

export interface FinishRunParams {
  runId: string;
  status: RunTerminalStatus;
  assistantContent: string;
  errorCode?: string;
  usagePromptTokens: number | null;
  usageCompletionTokens: number | null;
  usageTotalTokens: number | null;
  durationMs: number | null;
  reconcilerId?: string;
  expectedUpstreamRunId?: string;
}

export interface RunTerminalizationInput {
  runId: string;
  finalStatus: RunTerminalStatus;
  assistantContent?: string;
  errorCode?: string;
  usage?: RunTerminalUsage | null;
  durationMs?: number | null;
  expectedUpstreamRunId?: string;
}

export interface RunTerminalizationDependencies {
  ownerId: string;
  finishRun(params: FinishRunParams): Promise<FinishRunResult>;
  getRun(runId: string): Promise<RunTerminalRecord | null>;
  addEvent(runId: string, event: string, data: string): void;
  emitConversationUpdated(payload: {
    userId: string;
    instanceId: string;
    conversationId: string;
    runId: string;
    source: "run_completed" | "run_failed";
    status: string;
  }): void;
  setTerminalExpiry(runId: string): void;
  observeUsage?(input: {
    runId: string;
    effectiveStatus: RunTerminalStatus;
    usage: RunTerminalUsage;
  }): Promise<void>;
  warn(message: string): void;
}

export function sanitizeRunErrorCode(rawError: unknown): string {
  if (!rawError) return "UPSTREAM_FAILED";
  const upper = (typeof rawError === "string" ? rawError : String(rawError)).toUpperCase();
  const whitelist = [
    "USER_MESSAGE_MISSING",
    "INVALID_UPSTREAM_RUN_ID",
    "DISPATCH_MAX_ATTEMPTS_EXCEEDED",
    "RUNTIME_TIMEOUT_EXCEEDED",
    "UPSTREAM_FAILED",
    "CANCELLED_UPSTREAM",
    "UPSTREAM_RUN_NOT_FOUND",
    "CANCELLED_BY_USER",
    "INSTANCE_OFFLINE",
    "DISPATCH_FAILED",
    "STOP_CONFIRMATION_TIMEOUT",
    "STOP_REQUEST_FAILED",
    "TIMEOUT_EXCEEDED",
    "UPSTREAM_RUN_ID_CONFLICT",
    "HERMES_SESSION_REBIND_FAILED",
    "HERMES_SESSION_CREATE_FAILED",
    "SESSION_NOT_FOUND",
    "INVALID_SESSION_ID",
    "SESSION_EXPIRED",
    "UNKNOWN_SESSION",
  ];

  if (whitelist.includes(upper)) return upper;
  if (upper.includes("TIMEOUT")) return "TIMEOUT_EXCEEDED";
  if (upper.includes("OFFLINE") || upper.includes("CONN") || upper.includes("SOCKET") || upper.includes("UNREACHABLE")) {
    return "INSTANCE_OFFLINE";
  }
  if (upper.includes("CANCEL")) return "CANCELLED_UPSTREAM";
  return "UPSTREAM_FAILED";
}

function publishTerminalEvents(
  input: {
    runId: string;
    status: string;
    errorCode: string | null;
    durationMs: number | null;
  },
  dependencies: RunTerminalizationDependencies,
): void {
  dependencies.addEvent(input.runId, "step", JSON.stringify(sanitizeStep({
    id: `${input.runId}-final`,
    stepType: "final",
    status: input.status === "completed" ? "completed" : "failed",
    title: input.status === "completed" ? "Final answer generated" : "Agent run ended",
    completedAt: Date.now(),
  })));
  dependencies.addEvent(input.runId, "status", JSON.stringify({
    status: input.status,
    errorCode: input.errorCode,
    durationMs: input.durationMs,
  }));
}

function notifyConversation(
  runId: string,
  status: string,
  run: RunTerminalRecord | null,
  dependencies: RunTerminalizationDependencies,
): void {
  if (!run?.user_id || !run.instance_id || !run.conversation_id) return;
  dependencies.emitConversationUpdated({
    userId: run.user_id,
    instanceId: run.instance_id,
    conversationId: run.conversation_id,
    runId,
    source: status === "completed" ? "run_completed" : "run_failed",
    status,
  });
}

export async function terminalizeRun(
  input: RunTerminalizationInput,
  dependencies: RunTerminalizationDependencies,
): Promise<boolean> {
  const assistantContent = input.assistantContent ?? "";
  const leakedToolProtocol = input.finalStatus === "completed" && containsDsmlToolCallProtocol(assistantContent);
  const effectiveStatus: RunTerminalStatus = leakedToolProtocol ? "failed" : input.finalStatus;
  const effectiveAssistantContent = leakedToolProtocol ? "" : assistantContent;
  const safeErrorCode = effectiveStatus === "completed"
    ? undefined
    : sanitizeRunErrorCode(leakedToolProtocol ? DSML_TOOL_CALL_ERROR_CODE : input.errorCode);

  if (leakedToolProtocol) {
    dependencies.warn(JSON.stringify({
      operation: "agent_dsml_tool_call_leak_blocked",
      runId: input.runId,
      errorCode: DSML_TOOL_CALL_ERROR_CODE,
    }));
  }

  if (input.usage && dependencies.observeUsage) {
    await dependencies.observeUsage({ runId: input.runId, effectiveStatus, usage: input.usage });
  }

  const result = await dependencies.finishRun({
    runId: input.runId,
    status: effectiveStatus,
    assistantContent: effectiveAssistantContent,
    errorCode: safeErrorCode,
    usagePromptTokens: input.usage?.prompt_tokens ?? input.usage?.input_tokens ?? null,
    usageCompletionTokens: input.usage?.completion_tokens ?? input.usage?.output_tokens ?? null,
    usageTotalTokens: input.usage?.total_tokens ?? null,
    durationMs: input.durationMs ?? null,
    reconcilerId: input.expectedUpstreamRunId ? undefined : dependencies.ownerId,
    expectedUpstreamRunId: input.expectedUpstreamRunId,
  });

  if (result.status === "already_terminal") {
    const latestRun = await dependencies.getRun(input.runId);
    const dbStatus = latestRun?.status || input.finalStatus;
    publishTerminalEvents({
      runId: input.runId,
      status: dbStatus,
      errorCode: latestRun?.error_code || null,
      durationMs: latestRun?.duration_ms || null,
    }, dependencies);
    notifyConversation(input.runId, dbStatus, latestRun, dependencies);
    dependencies.setTerminalExpiry(input.runId);
    return true;
  }

  if (result.status !== "success" && result.status !== "failure_recorded") {
    dependencies.warn(`[RunsReconciler] finishChatRun failed with status ${result.status} for run ${input.runId}. Aborting completion event.`);
    return false;
  }

  publishTerminalEvents({
    runId: input.runId,
    status: effectiveStatus,
    errorCode: safeErrorCode || null,
    durationMs: input.durationMs || null,
  }, dependencies);
  const latestRun = await dependencies.getRun(input.runId).catch(() => null);
  notifyConversation(input.runId, effectiveStatus, latestRun, dependencies);
  dependencies.setTerminalExpiry(input.runId);
  return true;
}
