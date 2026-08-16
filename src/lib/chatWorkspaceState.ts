export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sequence_no?: number;
  status?: "pending" | "completed" | "failed" | "superseded" | "queued" | "stopped";
  error_code?: string;
  error_message?: string;
  request_id?: string | null;
  conversation_id?: string | null;
  metadata?: Record<string, unknown> | null;
  usage_prompt_tokens?: number | null;
  usage_completion_tokens?: number | null;
  usage_total_tokens?: number | null;
  duration_ms?: number | null;
  credits_charged?: number | null;
  credit_balance_after?: number | null;
  user_feedback?: "like" | "dislike" | null;
}

export interface OptimisticChatContext {
  instanceId: string;
  conversationId: string;
  requestId: string;
  userMessageId: string;
  userMessageIds?: string[];
  assistantMessageId?: string;
  phase: "sending" | "settled";
}

/**
 * Deduplicates a list of messages.
 * Prioritizes message ID, then sequence number if ID is missing.
 * Sorts by sequence number asc, keeping temporary/pending messages at the end in stable order.
 */
export function deduplicateMessages(msgs: ChatMessage[], selectedConversationId: string | null): ChatMessage[] {
  const scopedMessages = selectedConversationId
    ? msgs.filter(m => !m.conversation_id || m.conversation_id === selectedConversationId)
    : msgs;
  const seen = new Set<string>();
  const unique: ChatMessage[] = [];
  for (const m of scopedMessages) {
    const key = m.id || `${selectedConversationId}-${m.sequence_no}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(m);
    }
  }
  const withSeq = unique.filter(m => typeof m.sequence_no === "number");
  const withoutSeq = unique.filter(m => typeof m.sequence_no !== "number");
  withSeq.sort((a, b) => (a.sequence_no || 0) - (b.sequence_no || 0));
  return [...withSeq, ...withoutSeq];
}

/**
 * Reconciles the database history messages with the local optimistic messages
 * to prevent the database response from overriding active user message states.
 * Reconciles strictly by stable message ID, never role + content.
 */
export function reconcileConversationMessages(
  dbMessages: ChatMessage[],
  localMessages: ChatMessage[],
  optimisticContext: OptimisticChatContext | null,
  selectedConversationId: string | null
): ChatMessage[] {
  if (!selectedConversationId) return [];

  const result = [...dbMessages];

  // If we have an active optimistic context for the current conversation, ensure the user message is kept.
  // The assistant reply is also preserved until the authoritative history contains a matching persisted reply.
  // This avoids a visible flash where a successful Quick/Assist/Agent answer renders, then disappears because
  // the background history refresh raced ahead of local conversation state consistency.
  if (optimisticContext && optimisticContext.conversationId === selectedConversationId) {
    const optimisticUserIds = Array.from(new Set([
      optimisticContext.userMessageId,
      ...(optimisticContext.userMessageIds || [])
    ].filter(Boolean)));
    const optUserMsgs = optimisticUserIds
      .map(id => localMessages.find(m => m.id === id && m.role === "user" && (!m.conversation_id || m.conversation_id === selectedConversationId)))
      .filter((m): m is ChatMessage => !!m);
    const hasAuthoritativeUserForRequest = dbMessages.some(m => m.role === "user" && m.request_id === optimisticContext.requestId);
    const hasAuthoritativeUser = dbMessages.some(m => m.role === "user");

    for (const optUserMsg of optUserMsgs) {
      // Strictly verify active sending user messages by ID. Once a returned authoritative
      // user row for this request exists, it replaces temporary and queued user bubbles.
      const alreadyHasIt = dbMessages.some(m => m.id === optUserMsg.id);
      const shouldPreserveQueuedOptimisticUser = !!optimisticContext.userMessageIds?.includes(optUserMsg.id);
      if (!alreadyHasIt && !hasAuthoritativeUserForRequest && (optimisticContext.phase === "sending" || shouldPreserveQueuedOptimisticUser || !hasAuthoritativeUser)) {
        result.push(optUserMsg);
      }
    }

    const optAssistantMsg = optimisticContext.assistantMessageId
      ? localMessages.find(m => m.id === optimisticContext.assistantMessageId && m.role === "assistant" && (!m.conversation_id || m.conversation_id === selectedConversationId))
      : null;
    if (optAssistantMsg) {
      const dbUserMsg = dbMessages.find(m => m.request_id === optimisticContext.requestId && m.role === "user") || optUserMsgs[0] || [...dbMessages].reverse().find(m => m.role === "user");
      const alreadyHasIt = dbMessages.some(m => m.id === optAssistantMsg.id);
      const hasAuthoritativeAssistant = dbMessages.some(m => (
        m.role === "assistant" && (
          (typeof dbUserMsg?.sequence_no === "number" && typeof m.sequence_no === "number" && m.sequence_no > dbUserMsg.sequence_no) ||
          (!!optAssistantMsg.content && m.content === optAssistantMsg.content)
        )
      ));
      if (!alreadyHasIt && !hasAuthoritativeAssistant) {
        result.push(optAssistantMsg);
      }
    }
  }

  // Preserve only terminal UI-only messages that belong to the currently selected conversation.
  // Without this guard, failed/queued messages from a previous conversation can leak into the newly selected one.
  for (const localMsg of localMessages) {
    if (localMsg.conversation_id !== selectedConversationId) continue;
    if (localMsg.status === "failed" || localMsg.status === "superseded" || localMsg.status === "queued" || localMsg.status === "stopped") {
      const alreadyHasIt = dbMessages.some(m => m.id === localMsg.id);
      const alreadyHasAuthoritativeRequest = !!localMsg.request_id && dbMessages.some(m => (
        m.role === localMsg.role &&
        m.request_id === localMsg.request_id &&
        (!m.conversation_id || m.conversation_id === selectedConversationId)
      ));
      if (!alreadyHasIt && !alreadyHasAuthoritativeRequest) {
        result.push(localMsg);
      }
    }
  }

  return deduplicateMessages(result, selectedConversationId);
}

/**
 * Checks if a chat response is still valid for acceptance.
 */
export function shouldAcceptChatResponse(
  current: { selectedId: string | null; activeChatRequestId: string | null; activeChatGeneration: number },
  initial: { selectedId: string | null; requestId: string; activeChatGeneration: number }
): boolean {
  return (
    current.selectedId === initial.selectedId &&
    current.activeChatGeneration === initial.activeChatGeneration &&
    current.activeChatRequestId === initial.requestId
  );
}

/**
 * Checks if a loaded message history is still valid for acceptance.
 */
export function shouldAcceptMessageHistory(
  current: {
    selectedId: string | null;
    selectedConversationId: string | null;
    messageGeneration: number;
    historyRequestId: number;
  },
  initial: {
    selectedId: string | null;
    selectedConversationId: string | null;
    messageGeneration: number;
    historyRequestId: number;
  }
): boolean {
  return (
    current.selectedId === initial.selectedId &&
    current.selectedConversationId === initial.selectedConversationId &&
    current.messageGeneration === initial.messageGeneration &&
    current.historyRequestId === initial.historyRequestId
  );
}

/**
 * Checks if a loaded conversation list is still valid for acceptance.
 */
export function shouldAcceptConversationHistory(
  current: { selectedId: string | null; instanceGeneration: number },
  initial: { selectedId: string | null; instanceGeneration: number }
): boolean {
  return (
    current.selectedId === initial.selectedId &&
    current.instanceGeneration === initial.instanceGeneration
  );
}


