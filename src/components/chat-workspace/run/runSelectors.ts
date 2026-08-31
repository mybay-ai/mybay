import type { ChatMessage } from "../../../lib/chatWorkspaceState";
import type { RunExecutionState } from "./runTypes";

export function deriveRunAssistantText(state: RunExecutionState): string {
  if (typeof state.assistantText === "string" && state.assistantText.length > 0) return state.assistantText;
  return state.blocks.filter(block => block.type === "text").map(block => block.content).join("");
}

export function findExplicitRunAssistantMessageIndex(messages: ChatMessage[], state: RunExecutionState): number {
  if (state.assistantMessageId) {
    const byId = messages.findIndex(message => message.role === "assistant" && message.id === state.assistantMessageId &&
      (!state.conversationId || message.conversation_id === state.conversationId));
    if (byId >= 0) return byId;
  }
  const byRunId = messages.findIndex(message => message.role === "assistant" &&
    (!state.conversationId || message.conversation_id === state.conversationId) &&
    (message.metadata?.runId === state.runId || message.metadata?.run_id === state.runId));
  if (byRunId >= 0) return byRunId;
  if (state.requestId) {
    return messages.findIndex(message => message.role === "assistant" &&
      (!state.conversationId || message.conversation_id === state.conversationId) && (
      message.request_id === state.requestId || message.metadata?.requestId === state.requestId
    ));
  }
  return -1;
}

export function findRunAssistantMessageIndex(messages: ChatMessage[], state: RunExecutionState): number {
  const explicitIndex = findExplicitRunAssistantMessageIndex(messages, state);
  if (explicitIndex >= 0) return explicitIndex;
  if (state.assistantMessageId || state.runId || state.requestId) return -1;
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
