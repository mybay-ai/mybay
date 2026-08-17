export type RunExecutionStatus =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "stopping"
  | "status_unknown"
  | "completed"
  | "failed"
  | "cancelled"
  | "stopped"
  | "expired";

export type NormalizedRunEventType =
  | "text.delta"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "approval.requested"
  | "approval.resolved"
  | "status.changed";

export interface NormalizedRunEvent<TPayload = unknown> {
  seq: number;
  runId: string;
  conversationId?: string;
  requestId?: string;
  type: NormalizedRunEventType;
  payload: TPayload;
}

export interface TextRunBlock {
  id: string;
  type: "text";
  firstSeq: number;
  lastSeq: number;
  content: string;
}

export interface ToolRunBlock {
  id: string;
  type: "tool";
  firstSeq: number;
  lastSeq: number;
  toolCallId: string;
  tool: string;
  label?: string;
  stepType?: "web_search" | "file_read" | "tool_call" | "model_reasoning" | "final";
  status: "running" | "completed" | "failed";
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface ApprovalRunBlock {
  id: string;
  type: "approval";
  firstSeq: number;
  lastSeq: number;
  approvalId: string;
  status: "pending" | "resolved" | "expired";
  metadata?: Record<string, unknown>;
}

export interface StatusRunBlock {
  id: string;
  type: "status";
  firstSeq: number;
  lastSeq: number;
  status: RunExecutionStatus;
  errorCode?: string;
}

export type RunBlock = TextRunBlock | ToolRunBlock | ApprovalRunBlock | StatusRunBlock;

export interface RunExecutionState {
  runId: string;
  conversationId?: string;
  requestId?: string;
  assistantMessageId?: string;
  status: RunExecutionStatus;
  blocks: RunBlock[];
  lastProcessedSeq: number;
}

export interface TextDeltaPayload {
  delta: string;
}

export interface ToolEventPayload {
  id: string;
  tool: string;
  label?: string;
  stepType?: ToolRunBlock["stepType"];
  startedAt?: number;
  completedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface ApprovalEventPayload {
  id: string;
  status: ApprovalRunBlock["status"];
  metadata?: Record<string, unknown>;
}

export interface StatusEventPayload {
  status: RunExecutionStatus;
  errorCode?: string;
}
