import type { ChatMessage } from "../../lib/chatWorkspaceState";
import { normalizeStoredMessageStatus, normalizeStoredMessageError } from "./chatMessagePolicy";

export type StoredChatMessage = Partial<ChatMessage> & Pick<ChatMessage, "id" | "role"> & { requestId?: string | null };

/** Normalize persisted history consistently without changing its order or identity. */
export function mapStoredChatMessage(m: StoredChatMessage, conversationId: string | null): ChatMessage {
  return {
    id: m.id,
    role: m.role as "user" | "assistant",
    content: m.content || "",
    sequence_no: m.sequence_no,
    status: normalizeStoredMessageStatus(m.status, m.error_code),
    error_code: m.error_code || undefined,
    request_id: m.request_id || m.requestId || undefined,
    conversation_id: m.conversation_id || conversationId,
    error_message: normalizeStoredMessageError(m.status, m.error_code, m.error_message),
    metadata: m.metadata || null,
    usage_prompt_tokens: m.usage_prompt_tokens ?? null,
    usage_completion_tokens: m.usage_completion_tokens ?? null,
    usage_total_tokens: m.usage_total_tokens ?? null,
    duration_ms: m.duration_ms ?? null,
    created_at: m.created_at ?? null,
    updated_at: m.updated_at ?? null,
    user_feedback: m.user_feedback || undefined
  };
}
