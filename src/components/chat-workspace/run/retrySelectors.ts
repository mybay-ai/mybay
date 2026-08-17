import type { ChatMessage } from "../../../lib/chatWorkspaceState";

function getRequestId(message: ChatMessage): string | null {
  const metadataRequestId = message.metadata?.requestId;
  return message.request_id || (typeof metadataRequestId === "string" ? metadataRequestId : null);
}

export function findRetrySourceMessage(messages: ChatMessage[], assistantIndex: number): ChatMessage | undefined {
  const assistant = messages[assistantIndex];
  if (!assistant || assistant.role !== "assistant") return undefined;

  const requestId = getRequestId(assistant);
  if (requestId) {
    for (let index = assistantIndex - 1; index >= 0; index -= 1) {
      const candidate = messages[index];
      if (candidate.role === "user" && getRequestId(candidate) === requestId) return candidate;
    }
  }

  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") return messages[index];
  }
  return undefined;
}
