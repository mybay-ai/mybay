import { readLocalRunTimeline } from "../../../../shared/localRunTimeline";
import type { ChatMessage } from "../../../lib/chatWorkspaceState";
import { normalizeSseRunEvent } from "./runEventNormalizer";
import { createRunExecutionState, isTerminalExecutionStatus, reduceRunEvents, runReducer } from "./runReducer";
import type { NormalizedRunEvent, RunBlock, RunExecutionState } from "./runTypes";

export function restoreMessageTimeline(message: ChatMessage, conversationId: string | null): RunExecutionState | null {
  const runId = message.metadata?.run_id || message.metadata?.runId;
  if (message.role !== "assistant" || !conversationId || message.conversation_id !== conversationId || typeof runId !== "string") return null;
  const snapshot = readLocalRunTimeline(message.metadata?.run_timeline, runId, conversationId);
  if (!snapshot) return null;
  const events = snapshot.events.map(event => normalizeSseRunEvent({ ...event, seq: event.id, runId, conversationId }))
    .filter((event): event is NormalizedRunEvent => event !== null);
  const state = reduceRunEvents(createRunExecutionState({ runId, conversationId, assistantMessageId: message.id }), events);
  return { ...runReducer(state, { seq: state.lastProcessedSeq + 1, runId, conversationId,
    type: "status.changed", payload: { status: snapshot.status } }), timelinePartial: snapshot.partial };
}

export function selectMessageTimeline(message: ChatMessage, conversationId: string | null, live?: RunExecutionState | null) {
  const archived = restoreMessageTimeline(message, conversationId);
  if (archived) return archived;
  const runId = message.metadata?.run_id || message.metadata?.runId;
  if (!live || live.conversationId !== conversationId || (message.conversation_id && message.conversation_id !== conversationId)
    || (runId && runId !== live.runId)) return null;
  return live;
}

// Keep intermediate replies at their observed position and render the final reply once.
// A snapshot with no exact text alignment keeps the authoritative reply intact.
export function projectRunTimeline(execution: RunExecutionState, content: string): {
  blocks: RunBlock[]; finalContent: string; textUnaligned: boolean;
} {
  const blocks: RunBlock[] = [];
  for (const block of execution.blocks) {
    if (block.type === "tool" && (block.stepType === "final" || block.stepType === "model_reasoning")) continue;
    const previous = blocks[blocks.length - 1];
    if (previous?.type === "text" && block.type === "text") {
      blocks[blocks.length - 1] = { ...previous, content: previous.content + block.content, lastSeq: block.lastSeq };
    } else blocks.push(block);
  }
  const textBlocks = blocks.filter(block => block.type === "text");
  const allText = textBlocks.map(block => block.content).join("");
  const lastText = textBlocks[textBlocks.length - 1];
  if (!allText) return { blocks, finalContent: content, textUnaligned: false };
  if (allText === content) {
    let lastActionIndex = -1;
    blocks.forEach((block, index) => { if (block.type === "tool" || block.type === "approval") lastActionIndex = index; });
    const lastTextIndex = lastText ? blocks.indexOf(lastText) : -1;
    if (lastText && lastTextIndex > lastActionIndex) {
      return { blocks: blocks.filter(block => block !== lastText), finalContent: lastText.content, textUnaligned: false };
    }
    if (isTerminalExecutionStatus(execution.status)) {
      return { blocks: blocks.filter(block => block.type !== "text"), finalContent: content, textUnaligned: true };
    }
    return { blocks, finalContent: "", textUnaligned: false };
  }
  if (lastText && lastText.content.trim() === content.trim()) {
    return { blocks: blocks.filter(block => block !== lastText), finalContent: content, textUnaligned: false };
  }
  return { blocks: blocks.filter(block => block.type !== "text"), finalContent: content, textUnaligned: true };
}
