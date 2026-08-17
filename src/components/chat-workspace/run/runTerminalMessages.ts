import type { ChatMessage } from "../../../lib/chatWorkspaceState";
import type { RunExecutionState } from "./runTypes";
import { findRunAssistantMessageIndex } from "./runSelectors";
import { findRetrySourceMessage } from "./retrySelectors";

export function markRunMessagesStopped(
  messages: ChatMessage[],
  execution: RunExecutionState,
  errorMessage: string
): ChatMessage[] {
  const assistantIndex = findRunAssistantMessageIndex(messages, execution);
  if (assistantIndex >= 0) {
    const sourceUser = findRetrySourceMessage(messages, assistantIndex);
    return messages.map((message, index) => {
      if (index === assistantIndex) {
        return { ...message, status: "stopped", error_code: "RUN_STOPPED", error_message: errorMessage };
      }
      if (sourceUser && message.id === sourceUser.id && message.status !== "completed") {
        return { ...message, status: "completed", error_code: undefined, error_message: undefined };
      }
      return message;
    });
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      return messages.map((message, messageIndex) => messageIndex === index
        ? { ...message, status: "stopped", error_code: "RUN_STOPPED", error_message: errorMessage }
        : message);
    }
  }
  return messages;
}
