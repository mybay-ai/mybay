import type {
  ApprovalEventPayload,
  NormalizedRunEvent,
  RunExecutionStatus,
  StatusEventPayload,
  TextDeltaPayload,
  ToolEventPayload,
  ToolRunBlock
} from "./runTypes";

type EventContext = {
  seq: number;
  event: string;
  data: string;
  runId: string;
  conversationId?: string;
  requestId?: string;
};

function parseObject(data: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function readString(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function readNumber(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function normalizeStepType(value: string): ToolRunBlock["stepType"] {
  return ["web_search", "file_read", "tool_call", "model_reasoning", "final"].includes(value)
    ? value as ToolRunBlock["stepType"]
    : "tool_call";
}

function normalizeRunStatus(value: string): RunExecutionStatus | null {
  const status = value.toLowerCase();
  if (status === "canceled") return "cancelled";
  return ["queued", "running", "waiting_for_approval", "stopping", "status_unknown", "completed", "failed", "cancelled", "stopped", "expired"].includes(status)
    ? status as RunExecutionStatus
    : null;
}

export function normalizeSseRunEvent(context: EventContext): NormalizedRunEvent | null {
  if (!Number.isSafeInteger(context.seq) || context.seq < 0 || !context.runId) return null;
  const base = {
    seq: context.seq,
    runId: context.runId,
    conversationId: context.conversationId,
    requestId: context.requestId
  };

  if (context.event === "text") {
    if (!context.data) return null;
    return { ...base, type: "text.delta", payload: { delta: context.data } satisfies TextDeltaPayload };
  }

  const record = parseObject(context.data);
  if (!record) return null;

  if (context.event === "step") {
    const status = readString(record, "status").toLowerCase();
    const payload: ToolEventPayload = {
      id: readString(record, "id", "step_id") || `step-${context.seq}`,
      tool: readString(record, "tool_name", "tool", "name") || "other",
      label: readString(record, "title", "safe_summary", "name") || undefined,
      stepType: normalizeStepType(readString(record, "stepType", "step_type")),
      startedAt: readNumber(record, "startedAt", "started_at"),
      completedAt: readNumber(record, "completedAt", "completed_at"),
      metadata: record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
        ? record.metadata as Record<string, unknown>
        : {}
    };
    return {
      ...base,
      type: status === "failed" ? "tool.failed" : status === "completed" ? "tool.completed" : "tool.started",
      payload
    };
  }

  if (context.event === "approval") {
    const status = readString(record, "status").toLowerCase();
    const payload: ApprovalEventPayload = {
      id: readString(record, "id") || `approval-${context.seq}`,
      status: status === "resolved" ? "resolved" : status === "expired" ? "expired" : "pending",
      metadata: record
    };
    return { ...base, type: payload.status === "pending" ? "approval.requested" : "approval.resolved", payload };
  }

  if (context.event === "status") {
    const status = normalizeRunStatus(readString(record, "status"));
    if (!status) return null;
    const payload: StatusEventPayload = {
      status,
      errorCode: readString(record, "errorCode", "error_code") || undefined
    };
    return { ...base, type: "status.changed", payload };
  }

  return null;
}
