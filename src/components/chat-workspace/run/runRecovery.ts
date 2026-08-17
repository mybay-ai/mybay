import type { ChatMessage } from "../../../lib/chatWorkspaceState";
import type { RunExecutionStatus } from "./runTypes";

const RECOVERABLE_STATUSES = new Set<RunExecutionStatus>([
  "queued",
  "running",
  "waiting_for_approval",
  "stopping",
  "status_unknown"
]);

export interface ActiveRunRecoverySnapshot {
  id: string;
  status?: unknown;
  userMessageId?: unknown;
  requestId?: unknown;
  partialOutput?: unknown;
  startedAt?: unknown;
  createdAt?: unknown;
}

export function normalizeRecoveredRunStatus(value: unknown): RunExecutionStatus {
  const normalized = String(value || "").trim().toLowerCase() as RunExecutionStatus;
  return RECOVERABLE_STATUSES.has(normalized) ? normalized : "running";
}

export function recoverActiveRunMessages(
  messages: ChatMessage[],
  activeRun: ActiveRunRecoverySnapshot,
  conversationId: string
): { messages: ChatMessage[]; assistantMessageId: string; requestId?: string; status: RunExecutionStatus; partialOutput: string } {
  const requestId = typeof activeRun.requestId === "string" && activeRun.requestId ? activeRun.requestId : undefined;
  const partialOutput = typeof activeRun.partialOutput === "string" ? activeRun.partialOutput : "";
  const existingAssistant = messages.find(message => message.role === "assistant" && (
    message.metadata?.runId === activeRun.id ||
    message.metadata?.run_id === activeRun.id ||
    (requestId && message.request_id === requestId)
  ));
  if (existingAssistant) {
    return { messages, assistantMessageId: existingAssistant.id, requestId, status: normalizeRecoveredRunStatus(activeRun.status), partialOutput };
  }

  const assistantMessageId = `assistant-stream-${activeRun.id}`;
  const placeholder: ChatMessage = {
    id: assistantMessageId,
    role: "assistant",
    content: partialOutput,
    status: "pending",
    request_id: requestId,
    conversation_id: conversationId,
    metadata: { runId: activeRun.id, requestId }
  };
  const userMessageId = typeof activeRun.userMessageId === "string" ? activeRun.userMessageId : "";
  let userIndex = messages.findIndex(message => message.role === "user" && userMessageId && message.id === userMessageId);
  if (userIndex < 0 && requestId) {
    userIndex = messages.findIndex(message => message.role === "user" && message.request_id === requestId);
  }
  if (userIndex < 0) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === "user") {
        userIndex = index;
        break;
      }
    }
  }
  const insertionIndex = userIndex >= 0 ? userIndex + 1 : messages.length;
  return {
    messages: [...messages.slice(0, insertionIndex), placeholder, ...messages.slice(insertionIndex)],
    assistantMessageId,
    requestId,
    status: normalizeRecoveredRunStatus(activeRun.status),
    partialOutput
  };
}
