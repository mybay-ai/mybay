import { readLocalRunUsage, type LocalRunUsage } from "../../../shared/localRunUsage";
import type { ChatMessage } from "../../lib/chatWorkspaceState";

export function selectConversationContextUsage(messages: ChatMessage[]): LocalRunUsage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant" || message.status === "pending") continue;
    const usage = readLocalRunUsage(message.metadata?.usage_evidence);
    if (usage && (
      usage.contextTokens !== null
      || usage.contextWindow !== null
      || usage.contextPercent !== null
      || usage.compactionStatus !== null
    )) return usage;
  }
  return null;
}
