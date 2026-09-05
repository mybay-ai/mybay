import type { ChatMessage } from "../../../lib/chatWorkspaceState";
import { chooseMostCompleteStreamingContent } from "./runTextReconciliation";
import { deriveRunAssistantText, findExplicitRunAssistantMessageIndex } from "./runSelectors";
import type { RunExecutionState } from "./runTypes";

export type WorkspaceAssistantResult = {
  message?: ChatMessage;
  content: string;
  runId: string | null;
  live: boolean;
};

export function resolveWorkspaceAssistantResult(
  messages: ChatMessage[],
  runExecutionState: RunExecutionState | null | undefined,
  activeRunId: string | null | undefined
): WorkspaceAssistantResult {
  if (runExecutionState && activeRunId === runExecutionState.runId) {
    const index = findExplicitRunAssistantMessageIndex(messages, runExecutionState);
    const message = index >= 0 ? messages[index] : undefined;
    return {
      message,
      content: chooseMostCompleteStreamingContent(message?.content || "", deriveRunAssistantText(runExecutionState)),
      runId: runExecutionState.runId,
      live: true
    };
  }

  // A newly queued run must not borrow an earlier answer before its state arrives.
  const message = [...messages].reverse().find(item => item.role === "assistant" &&
    (activeRunId ? (item.metadata?.runId === activeRunId || item.metadata?.run_id === activeRunId) :
      Boolean(item.content?.trim() || item.metadata?.runId || item.metadata?.run_id)));
  return {
    message,
    content: message?.content || "",
    runId: activeRunId || (typeof message?.metadata?.runId === "string" ? message.metadata.runId :
      typeof message?.metadata?.run_id === "string" ? message.metadata.run_id : null),
    live: false
  };
}
