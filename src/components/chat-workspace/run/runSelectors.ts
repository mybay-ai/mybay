import type { ChatMessage } from "../../../lib/chatWorkspaceState";
import type { RunExecutionState } from "./runTypes";

export function findRunAssistantMessageIndex(messages: ChatMessage[], state: RunExecutionState): number {
  if (state.assistantMessageId) {
    const byId = messages.findIndex(message => message.role === "assistant" && message.id === state.assistantMessageId);
    if (byId >= 0) return byId;
  }
  const byRunId = messages.findIndex(message => message.role === "assistant" && message.metadata?.runId === state.runId);
  if (byRunId >= 0) return byRunId;
  if (state.requestId) {
    const byRequest = messages.findIndex(message => message.role === "assistant" && (
      message.request_id === state.requestId || message.metadata?.requestId === state.requestId
    ));
    if (byRequest >= 0) return byRequest;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant" && message.status === "pending" && message.conversation_id === state.conversationId) return index;
  }
  return -1;
}

export function shouldShowLegacyRunLoading(sending: boolean, state: RunExecutionState | null | undefined): boolean {
  return sending && (!state || state.blocks.length === 0);
}

export function isExecutionForConversation(state: RunExecutionState | null, conversationId: string | null): boolean {
  return Boolean(state && conversationId && state.conversationId === conversationId);
}
