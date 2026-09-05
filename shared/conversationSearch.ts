export interface ConversationSearchResult {
  conversation_id: string;
  conversation_title: string;
  project_id: string | null;
  matched_field: 'title' | 'message';
  message_id: string | null;
  message_role: string | null;
  sequence_no: number | null;
  snippet: string;
  matched_at: string;
}

export interface ConversationSearchPage {
  results: ConversationSearchResult[];
  nextCursor: string | null;
}

export function conversationSearchResultKey(result: ConversationSearchResult): string {
  return JSON.stringify([result.conversation_id, result.matched_field, result.message_id]);
}
