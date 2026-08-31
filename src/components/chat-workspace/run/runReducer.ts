import type { ChatToolStep } from "../ChatToolProgress";
import type {
  ApprovalEventPayload,
  ApprovalRunBlock,
  NormalizedRunEvent,
  RunBlock,
  RunExecutionState,
  RunExecutionStatus,
  StatusEventPayload,
  StatusRunBlock,
  TextDeltaPayload,
  TextRunBlock,
  ToolEventPayload,
  ToolRunBlock
} from "./runTypes";
import { chooseMostCompleteStreamingContent } from "./runTextReconciliation";

const TERMINAL_STATUSES = new Set<RunExecutionStatus>(["completed", "failed", "cancelled", "stopped", "expired"]);

export function isTerminalExecutionStatus(status: RunExecutionStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function createRunExecutionState(params: {
  runId: string;
  conversationId?: string;
  requestId?: string;
  assistantMessageId?: string;
  status?: RunExecutionStatus;
  initialText?: string;
  initialStep?: ToolEventPayload;
}): RunExecutionState {
  const blocks: RunBlock[] = [];
  if (params.initialText) {
    blocks.push({
      id: `${params.runId}-text-initial`,
      type: "text",
      firstSeq: -1,
      lastSeq: -1,
      content: params.initialText
    });
  }
  if (params.initialStep) {
    blocks.push({
      id: `${params.runId}-tool-${params.initialStep.id}`,
      type: "tool",
      firstSeq: -1,
      lastSeq: -1,
      toolCallId: params.initialStep.id,
      tool: params.initialStep.tool,
      label: params.initialStep.label,
      stepType: params.initialStep.stepType,
      status: "running",
      startedAt: params.initialStep.startedAt,
      metadata: params.initialStep.metadata
    });
  }
  return {
    runId: params.runId,
    conversationId: params.conversationId,
    requestId: params.requestId,
    assistantMessageId: params.assistantMessageId,
    status: params.status || "queued",
    assistantText: params.initialText || "",
    streamText: params.initialText || "",
    blocks,
    lastProcessedSeq: -1
  };
}

function replaceBlock(blocks: RunBlock[], index: number, block: RunBlock): RunBlock[] {
  const next = [...blocks];
  next[index] = block;
  return next;
}

function reduceTextDelta(state: RunExecutionState, event: NormalizedRunEvent<TextDeltaPayload>): RunExecutionState {
  const delta = typeof event.payload?.delta === "string" ? event.payload.delta : "";
  if (!delta) return { ...state, lastProcessedSeq: event.seq };
  const blockText = state.blocks
    .filter((block): block is TextRunBlock => block.type === "text")
    .map(block => block.content)
    .join("");
  const streamText = (state.streamText ?? blockText) + delta;
  const assistantText = chooseMostCompleteStreamingContent(state.assistantText || blockText, streamText);
  const last = state.blocks[state.blocks.length - 1];
  if (last?.type === "text") {
    const updated: TextRunBlock = { ...last, content: last.content + delta, lastSeq: event.seq };
    return { ...state, assistantText, streamText, blocks: replaceBlock(state.blocks, state.blocks.length - 1, updated), lastProcessedSeq: event.seq };
  }
  const block: TextRunBlock = {
    id: `${state.runId}-text-${event.seq}`,
    type: "text",
    firstSeq: event.seq,
    lastSeq: event.seq,
    content: delta
  };
  return { ...state, assistantText, streamText, blocks: [...state.blocks, block], lastProcessedSeq: event.seq };
}

function reduceToolEvent(state: RunExecutionState, event: NormalizedRunEvent<ToolEventPayload>): RunExecutionState {
  const payload = event.payload;
  const toolCallId = String(payload?.id || `tool-${event.seq}`);
  const index = state.blocks.findIndex(block => block.type === "tool" && block.toolCallId === toolCallId);
  const requestedStatus: ToolRunBlock["status"] = event.type === "tool.failed"
    ? "failed"
    : event.type === "tool.completed"
      ? "completed"
      : "running";

  if (index >= 0) {
    const current = state.blocks[index] as ToolRunBlock;
    const nextStatus = current.status !== "running" && requestedStatus === "running" ? current.status : requestedStatus;
    const startedAt = payload.startedAt ?? current.startedAt;
    const completedAt = payload.completedAt ?? current.completedAt;
    const updated: ToolRunBlock = {
      ...current,
      lastSeq: event.seq,
      tool: payload.tool || current.tool,
      label: payload.label || current.label,
      stepType: payload.stepType || current.stepType,
      status: nextStatus,
      completionInferred: requestedStatus === "running" ? current.completionInferred : false,
      startedAt,
      completedAt,
      durationMs: startedAt !== undefined && completedAt !== undefined ? Math.max(0, completedAt - startedAt) : current.durationMs,
      metadata: { ...(current.metadata || {}), ...(payload.metadata || {}) }
    };
    return { ...state, blocks: replaceBlock(state.blocks, index, updated), lastProcessedSeq: event.seq };
  }

  const block: ToolRunBlock = {
    id: `${state.runId}-tool-${toolCallId}`,
    type: "tool",
    firstSeq: event.seq,
    lastSeq: event.seq,
    toolCallId,
    tool: payload.tool || "other",
    label: payload.label,
    stepType: payload.stepType,
    status: requestedStatus,
    startedAt: payload.startedAt,
    completedAt: payload.completedAt,
    durationMs: payload.startedAt !== undefined && payload.completedAt !== undefined
      ? Math.max(0, payload.completedAt - payload.startedAt)
      : undefined,
    metadata: payload.metadata
  };
  return { ...state, blocks: [...state.blocks, block], lastProcessedSeq: event.seq };
}

function reduceApproval(state: RunExecutionState, event: NormalizedRunEvent<ApprovalEventPayload>): RunExecutionState {
  const payload = event.payload;
  const approvalId = String(payload?.id || `approval-${event.seq}`);
  const index = state.blocks.findIndex(block => block.type === "approval" && block.approvalId === approvalId);
  if (index >= 0) {
    const current = state.blocks[index] as ApprovalRunBlock;
    const updated: ApprovalRunBlock = {
      ...current,
      lastSeq: event.seq,
      status: current.status !== "pending" && payload.status === "pending" ? current.status : payload.status,
      metadata: { ...(current.metadata || {}), ...(payload.metadata || {}) }
    };
    return { ...state, blocks: replaceBlock(state.blocks, index, updated), lastProcessedSeq: event.seq };
  }
  const block: ApprovalRunBlock = {
    id: `${state.runId}-approval-${approvalId}`,
    type: "approval",
    firstSeq: event.seq,
    lastSeq: event.seq,
    approvalId,
    status: payload.status,
    metadata: payload.metadata
  };
  return { ...state, blocks: [...state.blocks, block], lastProcessedSeq: event.seq };
}

function reduceStatus(state: RunExecutionState, event: NormalizedRunEvent<StatusEventPayload>): RunExecutionState {
  const status = event.payload?.status || state.status;
  const finishedAt = Date.now();
  const blocks = isTerminalExecutionStatus(status)
    ? state.blocks.map(block => {
      if (block.type === "tool" && block.status === "running") {
        return { ...block, status: status === "completed" ? "completed" as const : "failed" as const, completionInferred: true, completedAt: block.completedAt || finishedAt };
      }
      if (block.type === "approval" && block.status === "pending") return { ...block, status: "expired" as const };
      return block;
    })
    : state.blocks;
  const previous = blocks[blocks.length - 1];
  if (previous?.type === "status" && previous.status === status) {
    const updated: StatusRunBlock = { ...previous, lastSeq: event.seq, errorCode: event.payload?.errorCode || previous.errorCode };
    return { ...state, status, blocks: replaceBlock(blocks, blocks.length - 1, updated), lastProcessedSeq: event.seq };
  }
  const block: StatusRunBlock = {
    id: `${state.runId}-status-${event.seq}`,
    type: "status",
    firstSeq: event.seq,
    lastSeq: event.seq,
    status,
    errorCode: event.payload?.errorCode
  };
  return { ...state, status, blocks: [...blocks, block], lastProcessedSeq: event.seq };
}

export function runReducer(state: RunExecutionState, event: NormalizedRunEvent): RunExecutionState {
  if (event.runId !== state.runId || event.seq <= state.lastProcessedSeq) return state;
  if (state.conversationId && event.conversationId && event.conversationId !== state.conversationId) return state;
  if (isTerminalExecutionStatus(state.status)) return state;

  switch (event.type) {
    case "text.delta":
      return reduceTextDelta(state, event as NormalizedRunEvent<TextDeltaPayload>);
    case "tool.started":
    case "tool.completed":
    case "tool.failed":
      return reduceToolEvent(state, event as NormalizedRunEvent<ToolEventPayload>);
    case "approval.requested":
    case "approval.resolved":
      return reduceApproval(state, event as NormalizedRunEvent<ApprovalEventPayload>);
    case "status.changed":
      return reduceStatus(state, event as NormalizedRunEvent<StatusEventPayload>);
    default:
      return state;
  }
}

export function reduceRunEvents(state: RunExecutionState, events: NormalizedRunEvent[]): RunExecutionState {
  return [...events].sort((a, b) => a.seq - b.seq).reduce(runReducer, state);
}

export function deriveAssistantText(blocks: RunBlock[]): string {
  return blocks.filter(block => block.type === "text").map(block => block.content).join("");
}

export function deriveToolSteps(blocks: RunBlock[]): ChatToolStep[] {
  return blocks.filter((block): block is ToolRunBlock => block.type === "tool").map(block => ({
    id: block.toolCallId,
    name: block.label || block.tool,
    title: block.label,
    tool_name: block.tool,
    status: block.status,
    stepType: block.stepType,
    startedAt: block.startedAt,
    completedAt: block.completedAt,
    metadata: block.metadata || {}
  }));
}
