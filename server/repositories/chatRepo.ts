import { placeConversation, type ConversationPlacement } from "../../shared/localConversationPlacement";
import { readLocalRunUsage, type LocalRunUsage } from "../../shared/localRunUsage";
import { readLocalModelEvidence, type LocalModelEvidence } from "../../shared/localModelEvidence";
import { settleRunQuestions } from "../../shared/localRunQuestions";
import { readLocalFileEvidence, type LocalFileEvidence } from "../../shared/localRunFileEvidence";
import { readLocalRunTimeline, type LocalRunTimeline } from "../../shared/localRunTimeline";
import type { LocalRunFileDiffs } from "../../shared/localRunFileDiff";
import { pruneRunFileDiffs, validateRunFileDiffs } from "../services/runs/runFileSnapshots";
import { randomUUID } from "crypto";
import {
  mutateStore,
  mutateStoreCollections,
  nowIso,
  readStore,
  readStoreCollections,
} from "../localStore";
import {
  CHAT_CONTEXT_CHAR_BUDGET,
  CHAT_CONTEXT_MESSAGE_LIMIT,
  selectRecentMessagesForContext
} from "../../shared/chatMessageContract";
import type { RuntimeBinding } from "../runtime/contracts";
import { runtimeRegistry } from "../runtime/runtimeRegistry";

const IMMUTABLE_RUN_BINDING_FIELDS = [
  "runtime_type",
  "runtime_provider_key",
  "runtime_contract_version",
] as const;

export interface Conversation {
  id: string;
  user_id: string;
  instance_id: string;
  title: string;
  session_id: string | null;
  project_id?: string | null;
  pinned_at?: string | null;
  sort_order?: number | null;
  last_message_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatProject {
  id: string;
  user_id: string;
  instance_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  metadata?: Record<string, any>;
  id: string;
  conversation_id: string;
  instance_id?: string;
  role: string;
  content: string;
  status: string;
  sequence_no: number;
  request_id: string | null;
  error_code: string | null;
  usage_prompt_tokens: number | null;
  usage_completion_tokens: number | null;
  usage_total_tokens: number | null;
  duration_ms: number | null;
  created_at: string;
}

function nextSequence(messages: any[], conversationId: string): number {
  return messages
    .filter((m) => m.conversation_id === conversationId)
    .reduce((max, m) => Math.max(max, Number(m.sequence_no || 0)), 0) + 1;
}

function normalizeClaimedRun(row: any) {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    user_id: row.user_id,
    instance_id: row.instance_id,
    user_message_id: row.user_message_id,
    status: row.status,
    upstream_run_id: row.upstream_run_id || null,
    dispatch_attempts: Number(row.dispatch_attempts || 0),
    request_id: row.request_id,
    created_at: row.created_at,
    started_at: row.started_at || null,
    last_observed_at: row.last_observed_at || null,
    partial_output: row.partial_output || null,
    last_event_seq: Number(row.last_event_seq || 0),
    stop_attempts: Number(row.stop_attempts || 0),
    stop_requested_at: row.stop_requested_at || null,
    reasoning_effort: row.reasoning_effort || "balanced",
    runtime_type: row.runtime_type,
    runtime_provider_key: row.runtime_provider_key,
    runtime_contract_version: row.runtime_contract_version,
  };
}

function touchConversation(data: any, conversationId: string, updates: any = {}) {
  const conv = data.conversations.find((c: any) => c.id === conversationId);
  if (conv) Object.assign(conv, updates, { updated_at: nowIso(), last_message_at: updates.last_message_at || nowIso() });
  return conv;
}

export interface ConversationSearchResult {
  conversation_id: string;
  conversation_title: string;
  project_id: string | null;
  matched_field: "title" | "message";
  message_id: string | null;
  message_role: string | null;
  sequence_no: number | null;
  snippet: string;
  matched_at: string;
}

const UNORDERED_CONVERSATION_SORT = Number.MAX_SAFE_INTEGER;

function conversationSortValue(value: unknown): number {
  if (value === null || value === undefined || value === "") return UNORDERED_CONVERSATION_SORT;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : UNORDERED_CONVERSATION_SORT;
}

export function compareConversationOrder(a: Partial<Conversation>, b: Partial<Conversation>): number {
  const sortDiff = conversationSortValue(a.sort_order) - conversationSortValue(b.sort_order);
  if (sortDiff !== 0) return sortDiff;
  const updatedDiff = String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
  if (updatedDiff !== 0) return updatedDiff;
  return String(b.id || "").localeCompare(String(a.id || ""));
}

export function encodeConversationCursor(conversation: Partial<Conversation>): string {
  const normalizedSortOrder = conversationSortValue(conversation.sort_order);
  const sortOrder = normalizedSortOrder === UNORDERED_CONVERSATION_SORT ? "~" : String(normalizedSortOrder);
  return `${sortOrder}|${conversation.updated_at || ""}|${conversation.id || ""}`;
}

function isConversationAfterCursor(conversation: Conversation, cursor: string): boolean {
  const parts = cursor.split("|");
  if (parts.length < 3) {
    const [cursorUpdatedAt, cursorId] = parts;
    return String(conversation.updated_at || "") < cursorUpdatedAt
      || (String(conversation.updated_at || "") === cursorUpdatedAt && String(conversation.id || "") < cursorId);
  }
  const [rawSortOrder, cursorUpdatedAt, cursorId] = parts;
  const cursorSortOrder = rawSortOrder === "~" ? UNORDERED_CONVERSATION_SORT : conversationSortValue(rawSortOrder);
  const rowSortOrder = conversationSortValue(conversation.sort_order);
  if (rowSortOrder !== cursorSortOrder) return rowSortOrder > cursorSortOrder;
  return String(conversation.updated_at || "") < cursorUpdatedAt
    || (String(conversation.updated_at || "") === cursorUpdatedAt && String(conversation.id || "") < cursorId);
}

function assertUniqueIds(ids: string[], errorCode: string) {
  if (ids.length !== new Set(ids).size) throw new Error(errorCode);
}

function buildSearchSnippet(value: string, normalizedQuery: string, maxLength = 180): string {
  const compact = String(value || "").replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  const matchIndex = compact.toLocaleLowerCase().indexOf(normalizedQuery);
  const start = Math.max(0, Math.min(matchIndex - Math.floor(maxLength / 3), compact.length - maxLength));
  const end = Math.min(compact.length, start + maxLength);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
}

export const chatRepo = {
  async listProjects(userId: string, instanceId: string): Promise<ChatProject[]> {
    return readStore().chatProjects
      .filter((p) => p.user_id === userId && p.instance_id === instanceId && !p.is_archived)
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  },

  async getProject(userId: string, instanceId: string, projectId: string): Promise<ChatProject | null> {
    return readStore().chatProjects.find((p) => p.id === projectId && p.user_id === userId && p.instance_id === instanceId) || null;
  },

  async createProject(userId: string, instanceId: string, name: string): Promise<ChatProject> {
    return mutateStore((data) => {
      const now = nowIso();
      const scopedProjects = data.chatProjects.filter((project: any) => project.user_id === userId && project.instance_id === instanceId && !project.is_archived);
      const firstSortOrder = scopedProjects.reduce((min: number, project: any) => Math.min(min, Number(project.sort_order || 0)), 0) - 1;
      const row = { id: randomUUID(), user_id: userId, instance_id: instanceId, name, description: null, sort_order: firstSortOrder, is_archived: false, created_at: now, updated_at: now };
      data.chatProjects.push(row);
      return row;
    });
  },

  async reorderProjects(userId: string, instanceId: string, orderedIds: string[]): Promise<ChatProject[]> {
    return mutateStore((data) => {
      assertUniqueIds(orderedIds, "PROJECT_ORDER_INVALID");
      const scoped = data.chatProjects
        .filter((project: any) => project.user_id === userId && project.instance_id === instanceId && !project.is_archived)
        .sort((a: any, b: any) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
      const byId = new Map(scoped.map((project: any) => [project.id, project]));
      if (orderedIds.some((id) => !byId.has(id))) throw new Error("PROJECT_ORDER_INVALID");
      const requested = orderedIds.map((id) => byId.get(id)!);
      const requestedIds = new Set(orderedIds);
      const finalOrder = [...requested, ...scoped.filter((project: any) => !requestedIds.has(project.id))];
      const now = nowIso();
      finalOrder.forEach((project: any, index) => Object.assign(project, { sort_order: index, updated_at: now }));
      return finalOrder;
    });
  },

  async renameProject(userId: string, instanceId: string, projectId: string, name: string): Promise<ChatProject> {
    return mutateStore((data) => {
      const row = data.chatProjects.find((p) => p.id === projectId && p.user_id === userId && p.instance_id === instanceId);
      if (!row) throw new Error("PROJECT_NOT_FOUND");
      Object.assign(row, { name, updated_at: nowIso() });
      return row;
    });
  },

  async archiveProject(userId: string, instanceId: string, projectId: string): Promise<void> {
    mutateStore((data) => {
      const now = nowIso();
      const row = data.chatProjects.find((p) => p.id === projectId && p.user_id === userId && p.instance_id === instanceId);
      if (row) Object.assign(row, { is_archived: true, updated_at: now });
      data.conversations.forEach((c: any) => {
        if (c.user_id === userId && c.instance_id === instanceId && c.project_id === projectId) Object.assign(c, { project_id: null, updated_at: now });
      });
    });
  },

  async createConversation(userId: string, instanceId: string, title: string, projectId?: string | null): Promise<Conversation> {
    return mutateStore((data) => {
      const now = nowIso();
      const scoped = data.conversations.filter((conversation: any) => conversation.user_id === userId && conversation.instance_id === instanceId);
      const firstSortOrder = scoped.reduce((min: number, conversation: any) => Math.min(min, conversationSortValue(conversation.sort_order)), 0) - 1;
      const row = { id: randomUUID(), user_id: userId, instance_id: instanceId, title, session_id: null, project_id: projectId || null, pinned_at: null, sort_order: firstSortOrder, last_message_at: now, created_at: now, updated_at: now };
      data.conversations.push(row);
      return row;
    });
  },

  async listConversations(userId: string, instanceId: string, limit = 20, cursor?: string): Promise<Conversation[]> {
    let rows = readStore().conversations.filter((c) => c.user_id === userId && c.instance_id === instanceId);
    rows.sort(compareConversationOrder);
    if (cursor) {
      rows = rows.filter((conversation) => isConversationAfterCursor(conversation, cursor));
    }
    return rows.slice(0, limit);
  },

  async searchConversations(userId: string, instanceId: string, query: string, limit = 30): Promise<ConversationSearchResult[]> {
    const normalizedQuery = String(query || "").trim().toLocaleLowerCase();
    if (!normalizedQuery) return [];

    const store = readStore();
    const conversations = store.conversations.filter((conversation) => conversation.user_id === userId && conversation.instance_id === instanceId);
    const byConversationId = new Map(conversations.map((conversation) => [conversation.id, conversation]));
    const ranked: Array<ConversationSearchResult & { score: number }> = [];

    for (const conversation of conversations) {
      const title = String(conversation.title || "");
      const normalizedTitle = title.toLocaleLowerCase();
      if (normalizedTitle.includes(normalizedQuery)) {
        ranked.push({
          conversation_id: conversation.id,
          conversation_title: title,
          project_id: conversation.project_id || null,
          matched_field: "title",
          message_id: null,
          message_role: null,
          sequence_no: null,
          snippet: buildSearchSnippet(title, normalizedQuery),
          matched_at: conversation.updated_at,
          score: normalizedTitle === normalizedQuery ? 400 : normalizedTitle.startsWith(normalizedQuery) ? 350 : 300
        });
      }
    }

    for (const message of store.chatMessages) {
      const conversation = byConversationId.get(message.conversation_id);
      if (!conversation) continue;
      const content = typeof message.content === "string" ? message.content : "";
      if (!content.toLocaleLowerCase().includes(normalizedQuery)) continue;
      ranked.push({
        conversation_id: conversation.id,
        conversation_title: conversation.title,
        project_id: conversation.project_id || null,
        matched_field: "message",
        message_id: message.id,
        message_role: message.role || null,
        sequence_no: Number(message.sequence_no || 0),
        snippet: buildSearchSnippet(content, normalizedQuery),
        matched_at: message.created_at || conversation.updated_at,
        score: 200
      });
    }

    return ranked
      .sort((a, b) => b.score - a.score || String(b.matched_at || "").localeCompare(String(a.matched_at || "")) || Number(b.sequence_no || 0) - Number(a.sequence_no || 0))
      .slice(0, Math.max(1, Math.min(50, limit)))
      .map(({ score: _score, ...result }) => result);
  },

  async placeConversation(userId: string, instanceId: string, placement: ConversationPlacement): Promise<Conversation[]> {
    return mutateStoreCollections(["conversations", "chatProjects"] as const, data => {
      const scoped = data.conversations.filter(c => c.user_id === userId && c.instance_id === instanceId).sort(compareConversationOrder);
      const projectIds = data.chatProjects.filter(p => p.user_id === userId && p.instance_id === instanceId && !p.is_archived).map(p => p.id);
      const now = nowIso();
      const ordered = placeConversation(scoped, projectIds, placement, now);
      const byId = new Map(ordered.map(c => [c.id, c]));
      for (const row of scoped) {
        const next = byId.get(row.id)!;
        if (row.sort_order !== next.sort_order || row.project_id !== next.project_id || row.pinned_at !== next.pinned_at) {
          Object.assign(row, { sort_order: next.sort_order, project_id: next.project_id, pinned_at: next.pinned_at, updated_at: now });
        }
      }
      return scoped.sort(compareConversationOrder);
    });
  },

  async reorderConversations(userId: string, instanceId: string, orderedIds: string[]): Promise<Conversation[]> {
    return mutateStore((data) => {
      assertUniqueIds(orderedIds, "CONVERSATION_ORDER_INVALID");
      const scoped = data.conversations
        .filter((conversation: any) => conversation.user_id === userId && conversation.instance_id === instanceId)
        .sort(compareConversationOrder);
      const byId = new Map(scoped.map((conversation: any) => [conversation.id, conversation]));
      if (orderedIds.some((id) => !byId.has(id))) throw new Error("CONVERSATION_ORDER_INVALID");
      const requested = orderedIds.map((id) => byId.get(id)!);
      const requestedIds = new Set(orderedIds);
      const finalOrder = [...requested, ...scoped.filter((conversation: any) => !requestedIds.has(conversation.id))];
      const now = nowIso();
      finalOrder.forEach((conversation: any, index) => Object.assign(conversation, { sort_order: index, updated_at: now }));
      return finalOrder;
    });
  },

  async getConversation(userId: string, conversationId: string): Promise<Conversation | null> {
    return readStore().conversations.find((c) => c.id === conversationId && c.user_id === userId) || null;
  },

  async getConversationForOwnerAndInstance(userId: string, instanceId: string, conversationId: string): Promise<Conversation | null> {
    return readStore().conversations.find((c) => c.id === conversationId && c.user_id === userId && c.instance_id === instanceId) || null;
  },

  async deleteConversation(userId: string, conversationId: string): Promise<void> {
    mutateStore((data) => {
      const conv = data.conversations.find((c: any) => c.id === conversationId && c.user_id === userId);
      if (!conv) return;
      data.conversations = data.conversations.filter((c: any) => c.id !== conversationId);
      data.chatMessages = data.chatMessages.filter((m: any) => m.conversation_id !== conversationId);
      data.chatRuns = data.chatRuns.filter((r: any) => r.conversation_id !== conversationId);
      data.chatMessageFeedback = data.chatMessageFeedback.filter((f: any) => f.conversation_id !== conversationId);
    });
  },

  async updateConversationTitle(userId: string, conversationId: string, title: string): Promise<Conversation> {
    return mutateStore((data) => {
      const conv = data.conversations.find((c: any) => c.id === conversationId && c.user_id === userId);
      if (!conv) throw new Error("CONVERSATION_NOT_FOUND");
      Object.assign(conv, { title, updated_at: nowIso() });
      return conv;
    });
  },

  async updateConversationOrganization(userId: string, conversationId: string, updates: { projectId?: string | null; pinnedAt?: string | null; sortOrder?: number | null }): Promise<Conversation> {
    return mutateStore((data) => {
      const conv = data.conversations.find((c: any) => c.id === conversationId && c.user_id === userId);
      if (!conv) throw new Error("CONVERSATION_NOT_FOUND");
      const patch: any = { updated_at: nowIso() };
      if (Object.prototype.hasOwnProperty.call(updates, "projectId")) patch.project_id = updates.projectId || null;
      if (Object.prototype.hasOwnProperty.call(updates, "pinnedAt")) patch.pinned_at = updates.pinnedAt || null;
      if (Object.prototype.hasOwnProperty.call(updates, "sortOrder") && updates.sortOrder !== undefined && updates.sortOrder !== null) patch.sort_order = updates.sortOrder;
      Object.assign(conv, patch);
      return conv;
    });
  },

  async ensureConversationSessionId(conversationId: string): Promise<string> {
    const conv = readStoreCollections(["conversations"] as const).conversations.find((c) => c.id === conversationId);
    if (!conv) throw new Error("CONVERSATION_NOT_FOUND");
    if (conv.session_id && typeof conv.session_id === "string" && conv.session_id.trim()) return conv.session_id;
    throw new Error("CONVERSATION_SESSION_NOT_AVAILABLE");
  },

  async getConversationForSessionBinding(conversationId: string): Promise<Pick<Conversation, "id" | "title" | "session_id"> | null> {
    const conv = readStoreCollections(["conversations"] as const).conversations.find((c) => c.id === conversationId);
    return conv ? { id: conv.id, title: conv.title, session_id: conv.session_id || null } : null;
  },

  async bindConversationSessionId(conversationId: string, sessionId: string): Promise<void> {
    mutateStoreCollections(["conversations"] as const, (data) => {
      const conv = data.conversations.find((c: any) => c.id === conversationId);
      if (conv) Object.assign(conv, { session_id: sessionId, updated_at: nowIso() });
    });
  },

  async listMessages(conversationId: string, limit = 50, beforeSeq?: number): Promise<ChatMessage[]> {
    let rows = readStoreCollections(["chatMessages"] as const).chatMessages.filter((m) => m.conversation_id === conversationId);
    if (beforeSeq !== undefined && beforeSeq !== null) rows = rows.filter((m) => Number(m.sequence_no || 0) < beforeSeq);
    rows.sort((a, b) => Number(b.sequence_no || 0) - Number(a.sequence_no || 0));
    return rows.slice(0, limit).reverse();
  },

  async getLatestCompletedMessagesForContext(
    conversationId: string,
    limit = CHAT_CONTEXT_MESSAGE_LIMIT,
    maxChars = CHAT_CONTEXT_CHAR_BUDGET
  ): Promise<ChatMessage[]> {
    const messages = readStoreCollections(["chatMessages"] as const).chatMessages
      .filter((m) => m.conversation_id === conversationId);
    // Failed/cancelled async runs retain a completed user row for the UI. Do not
    // replay that orphaned instruction when the failed assistant row is omitted.
    // Filter before limiting so failed turns cannot crowd out useful context.
    const failedRequestIds = new Set(messages
      .filter((m) => m.role === "assistant" && m.status === "failed" && m.request_id)
      .map((m) => m.request_id));
    const rows = messages
      .filter((m) => m.status === "completed" && !failedRequestIds.has(m.request_id))
      .sort((a, b) => Number(b.sequence_no || 0) - Number(a.sequence_no || 0))
      .slice(0, limit)
      .reverse();
    return selectRecentMessagesForContext(rows, maxChars);
  },

  async getMessage(messageId: string): Promise<ChatMessage | null> {
    return readStoreCollections(["chatMessages"] as const).chatMessages.find((m) => m.id === messageId) || null;
  },

  async beginChatTurn(params: { conversationId: string; userId: string; instanceId: string; content: string; requestId: string; timeoutSeconds?: number; metadata?: any; }): Promise<{ status: string; message_id: string | null; sequence_no: number | null }> {
    return mutateStore((data) => {
      const conv = data.conversations.find((c: any) => c.id === params.conversationId && c.user_id === params.userId && c.instance_id === params.instanceId);
      if (!conv) throw new Error("CONVERSATION_NOT_FOUND_OR_ACCESS_DENIED");

      const existing = data.chatMessages.find((m: any) => m.conversation_id === params.conversationId && m.request_id === params.requestId && m.role === "user");
      if (existing) return { status: "DUPLICATE_REQUEST_ID", message_id: existing.id, sequence_no: existing.sequence_no };

      const now = nowIso();
      const nowMs = Date.now();
      const timeoutMs = Math.max(180, Number(params.timeoutSeconds || 180)) * 1000;
      for (const message of data.chatMessages) {
        if (message.conversation_id !== params.conversationId || message.role !== "user" || message.status !== "pending") continue;
        const createdMs = new Date(message.created_at || 0).getTime();
        if (Number.isFinite(createdMs) && nowMs - createdMs >= timeoutMs) {
          Object.assign(message, { status: "failed", error_code: "TURN_TIMEOUT", updated_at: now });
        }
      }

      const active = data.chatMessages.find((m: any) => m.conversation_id === params.conversationId && m.role === "user" && m.status === "pending");
      if (active) return { status: "CONCURRENT_REQUEST", message_id: null, sequence_no: null };

      const message = { id: randomUUID(), conversation_id: params.conversationId, instance_id: params.instanceId, role: "user", content: params.content, status: "pending", sequence_no: nextSequence(data.chatMessages, params.conversationId), request_id: params.requestId, error_code: null, usage_prompt_tokens: null, usage_completion_tokens: null, usage_total_tokens: null, duration_ms: null, metadata: params.metadata || {}, created_at: now, updated_at: now };
      data.chatMessages.push(message);
      Object.assign(conv, { updated_at: now, last_message_at: now });
      return { status: "success", message_id: message.id, sequence_no: message.sequence_no };
    });
  },

  async updateChatMessageMetadata(messageId: string, metadata: Record<string, any>): Promise<void> {
    mutateStore((data) => {
      const msg = data.chatMessages.find((m: any) => m.id === messageId);
      if (!msg) return;
      const existingMetadata = msg.metadata && typeof msg.metadata === "object" ? msg.metadata : {};
      Object.assign(msg, { metadata: { ...existingMetadata, ...metadata }, updated_at: nowIso() });
    });
  },

  async finishChatTurn(params: { conversationId: string; userMessageId: string; status: 'completed' | 'failed'; assistantContent?: string; errorCode?: string; usagePromptTokens?: number; usageCompletionTokens?: number; usageTotalTokens?: number; durationMs?: number; newSessionId?: string; usageEvidence?: LocalRunUsage; modelEvidence?: LocalModelEvidence | null; }): Promise<{ status: string; assistant_message_id: string | null; assistant_sequence_no: number | null }> {
    return mutateStore((data) => {
      const userMsg = data.chatMessages.find((m: any) => m.id === params.userMessageId && m.conversation_id === params.conversationId);
      if (!userMsg || userMsg.status !== "pending") return { status: "TURN_NOT_PENDING", assistant_message_id: null, assistant_sequence_no: null };
      const now = nowIso();
      userMsg.status = params.status;
      userMsg.error_code = params.errorCode ?? null;
      userMsg.updated_at = now;
      const assistant = { id: randomUUID(), conversation_id: params.conversationId, instance_id: userMsg.instance_id, role: "assistant", content: params.assistantContent ?? "", status: params.status, sequence_no: nextSequence(data.chatMessages, params.conversationId), request_id: userMsg.request_id, error_code: params.errorCode ?? null, usage_prompt_tokens: params.usagePromptTokens ?? null, usage_completion_tokens: params.usageCompletionTokens ?? null, usage_total_tokens: params.usageTotalTokens ?? null, duration_ms: params.durationMs ?? null, metadata: {}, created_at: now, updated_at: now };
      const usageEvidence = readLocalRunUsage(params.usageEvidence);
      if (usageEvidence) Object.assign(assistant.metadata, { usage_evidence: usageEvidence });
      const modelEvidence = readLocalModelEvidence(params.modelEvidence);
      if (modelEvidence) Object.assign(assistant.metadata, { model_evidence: modelEvidence });
      data.chatMessages.push(assistant);
      touchConversation(data, params.conversationId, params.newSessionId ? { session_id: params.newSessionId, last_message_at: now } : { last_message_at: now });
      return { status: params.status === "failed" ? "failed_logged" : "success", assistant_message_id: assistant.id, assistant_sequence_no: assistant.sequence_no };
    });
  },

  async beginChatRun(params: { conversationId: string; userId: string; instanceId: string; content: string; requestId: string; runId: string; reasoningEffort?: "fast" | "balanced" | "deep"; runtimeBinding?: RuntimeBinding; modelEvidence?: LocalModelEvidence | null; }): Promise<{ status: string; user_message_id: string | null; sequence_no: number | null; run_id?: string | null; run_status?: string | null }> {
    return mutateStoreCollections(["conversations", "chatMessages", "chatRuns"] as const, (data) => {
      const conv = data.conversations.find((c: any) => c.id === params.conversationId && c.user_id === params.userId && c.instance_id === params.instanceId);
      if (!conv) throw new Error("CONVERSATION_NOT_FOUND_OR_ACCESS_DENIED");

      const duplicateRequest = data.chatRuns.find((r: any) => r.user_id === params.userId && r.instance_id === params.instanceId && r.request_id === params.requestId);
      if (duplicateRequest) {
        const originalMessage = data.chatMessages.find((message: any) => message.id === duplicateRequest.user_message_id);
        const isExactReplay = duplicateRequest.conversation_id === params.conversationId
          && originalMessage?.content === params.content;
        return {
          status: isExactReplay ? "IDEMPOTENT_REPLAY" : "DUPLICATE_REQUEST_ID",
          user_message_id: duplicateRequest.user_message_id || null,
          sequence_no: originalMessage?.sequence_no ?? null,
          run_id: duplicateRequest.id,
          run_status: duplicateRequest.status || null,
        };
      }
      const duplicateRun = data.chatRuns.find((r: any) => r.id === params.runId);
      if (duplicateRun) return { status: "DUPLICATE_RUN", user_message_id: duplicateRun.user_message_id || null, sequence_no: null };
      const activeRun = data.chatRuns.find((r: any) => r.user_id === params.userId && r.instance_id === params.instanceId && ["queued", "running", "stopping"].includes(r.status));
      if (activeRun) return { status: "CONCURRENT_RUN", user_message_id: null, sequence_no: null };

      const now = nowIso();
      const runtimeBinding = params.runtimeBinding || runtimeRegistry.createBindingForInstance(undefined);
      runtimeRegistry.getForBinding(runtimeBinding);
      const userMessage = { id: randomUUID(), conversation_id: params.conversationId, instance_id: params.instanceId, role: "user", content: params.content, status: "pending", sequence_no: nextSequence(data.chatMessages, params.conversationId), request_id: params.requestId, error_code: null, usage_prompt_tokens: null, usage_completion_tokens: null, usage_total_tokens: null, duration_ms: null, metadata: { run_id: params.runId }, created_at: now, updated_at: now };
      data.chatMessages.push(userMessage);
      const modelEvidence = readLocalModelEvidence(params.modelEvidence);
      data.chatRuns.push({ id: params.runId, conversation_id: params.conversationId, user_id: params.userId, instance_id: params.instanceId, user_message_id: userMessage.id, status: "queued", upstream_run_id: null, dispatch_attempts: 0, request_id: params.requestId, partial_output: null, error_code: null, last_event_seq: 0, stop_attempts: 0, stop_requested_at: null, reconciled_by: null, lease_expires_at: null, reasoning_effort: params.reasoningEffort || "balanced", runtime_type: runtimeBinding.runtimeType, runtime_provider_key: runtimeBinding.providerKey, runtime_contract_version: runtimeBinding.contractVersion, ...(modelEvidence ? { model_evidence: modelEvidence } : {}), created_at: now, updated_at: now, started_at: null, completed_at: null, last_observed_at: null });
      Object.assign(conv, { updated_at: now, last_message_at: now });
      return { status: "success", user_message_id: userMessage.id, sequence_no: userMessage.sequence_no };
    });
  },

  async claimRuns(params: { reconcilerId: string; leaseSeconds: number; limit?: number; }): Promise<any[]> {
    return mutateStoreCollections(["chatRuns"] as const, (data) => {
      const now = Date.now();
      const leaseMs = Math.max(5, Math.min(Number(params.leaseSeconds || 60), 3600)) * 1000;
      const leaseExpiresAt = new Date(now + leaseMs).toISOString();
      const safeLimit = Math.max(1, Math.min(Number(params.limit || 10), 50));
      const candidates = data.chatRuns
        .filter((run: any) => ["queued", "running", "stopping"].includes(run.status) && (!run.reconciled_by || !run.lease_expires_at || new Date(run.lease_expires_at).getTime() < now))
        .sort((a: any, b: any) => String(a.created_at || "").localeCompare(String(b.created_at || "")))
        .slice(0, safeLimit);
      for (const run of candidates) Object.assign(run, { reconciled_by: params.reconcilerId, lease_expires_at: leaseExpiresAt, updated_at: nowIso() });
      return candidates.map(normalizeClaimedRun);
    });
  },

  async claimRunById(params: { runId: string; reconcilerId: string; leaseSeconds: number; }): Promise<any | null> {
    return mutateStoreCollections(["chatRuns"] as const, (data) => {
      const now = Date.now();
      const run = data.chatRuns.find((candidate: any) => candidate.id === params.runId);
      if (!run
        || !["queued", "running", "stopping"].includes(run.status)
        || (run.reconciled_by && run.lease_expires_at && new Date(run.lease_expires_at).getTime() >= now)) {
        return null;
      }
      const leaseMs = Math.max(5, Math.min(Number(params.leaseSeconds || 60), 3600)) * 1000;
      Object.assign(run, {
        reconciled_by: params.reconcilerId,
        lease_expires_at: new Date(now + leaseMs).toISOString(),
        updated_at: nowIso()
      });
      return normalizeClaimedRun(run);
    });
  },

  async requestStopChatRun(params: { runId: string; userId: string; instanceId: string; }): Promise<{ status: string; run_status: string | null }> {
    return mutateStoreCollections(["chatRuns"] as const, (data) => {
      const run = data.chatRuns.find((r: any) => r.id === params.runId && r.user_id === params.userId && r.instance_id === params.instanceId);
      if (!run) return { status: "run_not_found", run_status: null };
      if (["completed", "failed", "cancelled", "expired"].includes(run.status)) return { status: "already_terminal", run_status: run.status };
      Object.assign(run, { status: "stopping", stop_attempts: Number(run.stop_attempts || 0) + 1, stop_requested_at: nowIso(), updated_at: nowIso() });
      if (run.local_questions) run.local_questions = settleRunQuestions(run);
      return { status: "stop_requested", run_status: "stopping" };
    });
  },

  async recordDispatchedChatRun(params: { runId: string; reconcilerId: string; upstreamRunId: string; startedAt?: string; }): Promise<{ status: string; run_status: string | null }> {
    if (!/^[A-Za-z0-9_\-.]{1,128}$/.test(params.upstreamRunId || "")) return { status: "invalid_upstream_run_id", run_status: null };
    return mutateStoreCollections(["chatRuns"] as const, (data) => {
      const run = data.chatRuns.find((r: any) => r.id === params.runId);
      if (!run) return { status: "run_not_found", run_status: null };
      if (run.reconciled_by !== params.reconcilerId || !run.lease_expires_at || new Date(run.lease_expires_at).getTime() <= Date.now()) return { status: "lease_lost", run_status: null };
      if (run.upstream_run_id && run.upstream_run_id !== params.upstreamRunId) return { status: "upstream_id_conflict", run_status: run.status || null };
      const now = nowIso();
      Object.assign(run, { upstream_run_id: run.upstream_run_id || params.upstreamRunId, started_at: run.started_at || params.startedAt || now, last_observed_at: now, updated_at: now });
      if (run.status === "queued") run.status = "running";
      return { status: run.status === "stopping" ? "recorded_stopping" : "recorded_running", run_status: run.status };
    });
  },

  async renewRunLease(params: { runId: string; reconcilerId: string; leaseSeconds: number }): Promise<boolean> {
    return mutateStoreCollections(["chatRuns"] as const, (data) => {
      const run = data.chatRuns.find((r: any) => r.id === params.runId && r.reconciled_by === params.reconcilerId && ["queued", "running", "stopping"].includes(r.status));
      if (!run) return false;
      const leaseMs = Math.max(5, Math.min(Number(params.leaseSeconds || 60), 3600)) * 1000;
      Object.assign(run, { lease_expires_at: new Date(Date.now() + leaseMs).toISOString(), updated_at: nowIso() });
      return true;
    });
  },

  async releaseRunLease(params: { runId: string; reconcilerId: string }): Promise<boolean> {
    return mutateStoreCollections(["chatRuns"] as const, (data) => {
      const run = data.chatRuns.find((r: any) => r.id === params.runId && r.reconciled_by === params.reconcilerId);
      if (!run) return false;
      Object.assign(run, { reconciled_by: null, lease_expires_at: null, updated_at: nowIso() });
      return true;
    });
  },

  async finishChatRun(params: { runId: string; status: 'completed' | 'failed' | 'cancelled' | 'expired'; assistantContent?: string; errorCode?: string; usagePromptTokens?: number | null; usageCompletionTokens?: number | null; usageTotalTokens?: number | null; durationMs?: number | null; reconcilerId?: string; expectedUpstreamRunId?: string; completionAudit?: Record<string, unknown>; fileEvidence?: LocalFileEvidence; timeline?: LocalRunTimeline; fileDiffs?: LocalRunFileDiffs; usageEvidence?: LocalRunUsage; }): Promise<{ status: string; assistant_message_id: string | null; assistant_sequence_no: number | null }> {
    return mutateStoreCollections(["conversations", "chatMessages", "chatRuns"] as const, (data) => {
      const run = data.chatRuns.find((r: any) => r.id === params.runId);
      if (!run) return { status: "run_not_found", assistant_message_id: null, assistant_sequence_no: null };
      if (["completed", "failed", "cancelled", "expired"].includes(run.status)) return { status: "already_terminal", assistant_message_id: null, assistant_sequence_no: null };
      if (params.reconcilerId && (run.reconciled_by !== params.reconcilerId || !run.lease_expires_at || new Date(run.lease_expires_at).getTime() <= Date.now())) return { status: "lease_lost", assistant_message_id: null, assistant_sequence_no: null };
      if (params.expectedUpstreamRunId && (run.upstream_run_id !== params.expectedUpstreamRunId || !["running", "stopping"].includes(run.status))) return { status: "upstream_run_mismatch", assistant_message_id: null, assistant_sequence_no: null };
      const now = nowIso();
      const fileChanges = readLocalFileEvidence(params.fileEvidence, run.id);
      const fileEvidence = { version: 1 as const, runId: run.id, changes: fileChanges };
      const timeline = readLocalRunTimeline(params.timeline, run.id, run.conversation_id);
      const fileDiffs = validateRunFileDiffs(params.fileDiffs, run.id, run.conversation_id);
      const assistantStatus = params.status === "completed" ? "completed" : "failed";
      const assistant = { id: randomUUID(), conversation_id: run.conversation_id, instance_id: run.instance_id, role: "assistant", content: params.assistantContent ?? "", status: assistantStatus, sequence_no: nextSequence(data.chatMessages, run.conversation_id), request_id: run.request_id, error_code: params.errorCode ?? null, usage_prompt_tokens: params.usagePromptTokens ?? null, usage_completion_tokens: params.usageCompletionTokens ?? null, usage_total_tokens: params.usageTotalTokens ?? null, duration_ms: params.durationMs ?? null, metadata: { run_id: run.id, ...(fileChanges.length ? { file_evidence: fileEvidence } : {}), ...(params.completionAudit ? { completion_verification: params.completionAudit } : {}) }, created_at: now, updated_at: now };
      const usageEvidence = readLocalRunUsage(params.usageEvidence);
      if (usageEvidence) Object.assign(assistant.metadata, { usage_evidence: usageEvidence });
      const modelEvidence = readLocalModelEvidence(run.model_evidence);
      if (modelEvidence) Object.assign(assistant.metadata, { model_evidence: modelEvidence });
      data.chatMessages.push(assistant);
      if (timeline) Object.assign(assistant.metadata, { run_timeline: { ...timeline, status: params.status } });
      const userMessage = data.chatMessages.find((m: any) => m.id === run.user_message_id);
      if (userMessage) Object.assign(userMessage, { status: "completed", updated_at: now });
      Object.assign(run, { file_evidence: fileEvidence, status: params.status, error_code: params.errorCode ?? null, completed_at: now, updated_at: now, duration_ms: params.durationMs ?? null, usage_prompt_tokens: params.usagePromptTokens ?? null, usage_completion_tokens: params.usageCompletionTokens ?? null, usage_total_tokens: params.usageTotalTokens ?? null, reconciled_by: null, lease_expires_at: null, partial_output: params.assistantContent ?? run.partial_output ?? null });
      if (usageEvidence) Object.assign(run, { usage_evidence: usageEvidence });
      if (run.local_questions) run.local_questions = settleRunQuestions(run);
      if (fileDiffs?.files.length) Object.assign(run, { file_diffs: fileDiffs });
      pruneRunFileDiffs(data.chatRuns);
      touchConversation(data, run.conversation_id, { last_message_at: now });
      return { status: "success", assistant_message_id: assistant.id, assistant_sequence_no: assistant.sequence_no };
    });
  },

  async getChatRun(runId: string): Promise<any | null> {
    return readStoreCollections(["chatRuns"] as const).chatRuns.find((r) => r.id === runId) || null;
  },

  async updateChatRun(runId: string, updates: any, reconcilerId?: string): Promise<boolean> {
    if (!updates || typeof updates !== "object"
      || IMMUTABLE_RUN_BINDING_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(updates, field))) {
      return false;
    }
    return mutateStoreCollections(["chatRuns"] as const, (data) => {
      const run = data.chatRuns.find((r: any) => r.id === runId);
      if (!run) return false;
      if (reconcilerId && (run.reconciled_by !== reconcilerId || !run.lease_expires_at || new Date(run.lease_expires_at).getTime() <= Date.now())) return false;
      Object.assign(run, updates, { updated_at: nowIso() });
      return true;
    });
  },

  async listFeedbackByMessageIds(userId: string, messageIds: string[]): Promise<Record<string, string>> {
    const set = new Set(messageIds);
    return Object.fromEntries(readStore().chatMessageFeedback.filter((f) => f.user_id === userId && set.has(f.message_id)).map((f) => [f.message_id, f.rating]));
  },

  async getActiveRunForConversation(userId: string, instanceId: string, conversationId: string): Promise<any | null> {
    return readStoreCollections(["chatRuns"] as const).chatRuns
      .filter((r) => r.user_id === userId && r.instance_id === instanceId && r.conversation_id === conversationId && ["queued", "running", "stopping"].includes(r.status))
      .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")))[0] || null;
  },

  async upsertMessageFeedback(params: { userId: string; instanceId: string; conversationId: string; messageId: string; rating: "like" | "dislike"; reason?: string | null }) {
    return mutateStore((data) => {
      const now = nowIso();
      let row = data.chatMessageFeedback.find((f: any) => f.user_id === params.userId && f.message_id === params.messageId);
      if (!row) {
        row = { id: randomUUID(), message_id: params.messageId, conversation_id: params.conversationId, instance_id: params.instanceId, user_id: params.userId, created_at: now };
        data.chatMessageFeedback.push(row);
      }
      Object.assign(row, { rating: params.rating, reason: params.reason || null, updated_at: now });
      return { message_id: row.message_id, rating: row.rating, reason: row.reason || null, created_at: row.created_at, updated_at: row.updated_at };
    });
  },

  async deleteMessageFeedback(userId: string, messageId: string): Promise<void> {
    mutateStore((data) => {
      data.chatMessageFeedback = data.chatMessageFeedback.filter((f: any) => !(f.user_id === userId && f.message_id === messageId));
    });
  }
};
