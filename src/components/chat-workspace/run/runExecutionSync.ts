import type { ChatMessage } from "../../../lib/chatWorkspaceState";
import { chooseMostCompleteStreamingContent } from "./runTextReconciliation";
import { deriveRunAssistantText, findExplicitRunAssistantMessageIndex } from "./runSelectors";
import type { RunExecutionState } from "./runTypes";

export function applyRunExecutionToMessages(previous: ChatMessage[], state: RunExecutionState): ChatMessage[] {
  const targetIndex = findExplicitRunAssistantMessageIndex(previous, state);
  if (targetIndex < 0) return previous;
  const current = previous[targetIndex];
  const content = chooseMostCompleteStreamingContent(current.content || "", deriveRunAssistantText(state));
  const metadata = { ...(current.metadata || {}), runId: state.runId, requestId: state.requestId };
  if (content === current.content && current.metadata?.runId === state.runId && current.metadata?.requestId === state.requestId) {
    return previous;
  }
  const updated = [...previous];
  updated[targetIndex] = { ...current, content, metadata };
  return updated;
}

export function applyRunTextSnapshot(state: RunExecutionState, content: string): RunExecutionState {
  const currentText = deriveRunAssistantText(state);
  const assistantText = chooseMostCompleteStreamingContent(currentText, content);
  return assistantText === currentText
    ? state
    : { ...state, assistantText };
}
