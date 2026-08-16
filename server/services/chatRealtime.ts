import { EventEmitter } from "events";
import { Server as SocketIOServer, Socket } from "socket.io";

export const CHAT_CONVERSATION_UPDATED_EVENT = "chat_workspace:conversation_updated";

type ChatConversationUpdateSource =
  | "conversation_created"
  | "conversation_updated"
  | "conversation_deleted"
  | "user_message_created"
  | "assistant_message_completed"
  | "message_failed"
  | "run_created"
  | "run_completed"
  | "run_failed"
  | "files_updated";

export interface ChatConversationUpdatedPayload {
  userId: string;
  instanceId: string;
  conversationId: string;
  requestId?: string | null;
  runId?: string | null;
  source: ChatConversationUpdateSource;
  status?: string | null;
  timestamp?: string;
}

const chatRealtimeEmitter = new EventEmitter();

function userRoom(userId: string) {
  return `user:${userId}`;
}

function sanitizePayload(payload: ChatConversationUpdatedPayload): ChatConversationUpdatedPayload {
  return {
    userId: String(payload.userId || ""),
    instanceId: String(payload.instanceId || ""),
    conversationId: String(payload.conversationId || ""),
    requestId: payload.requestId ? String(payload.requestId) : null,
    runId: payload.runId ? String(payload.runId) : null,
    source: payload.source,
    status: payload.status ? String(payload.status) : null,
    timestamp: payload.timestamp || new Date().toISOString()
  };
}

export function setupChatRealtime(io: SocketIOServer) {
  io.on("connection", (socket: Socket) => {
    const userId = String((socket as any).user?.id || "");
    if (userId) {
      socket.join(userRoom(userId));
    }
  });

  chatRealtimeEmitter.on(CHAT_CONVERSATION_UPDATED_EVENT, (payload: ChatConversationUpdatedPayload) => {
    const safePayload = sanitizePayload(payload);
    if (!safePayload.userId || !safePayload.instanceId || !safePayload.conversationId) return;
    io.to(userRoom(safePayload.userId)).emit(CHAT_CONVERSATION_UPDATED_EVENT, safePayload);
  });
}

export function emitChatConversationUpdated(payload: ChatConversationUpdatedPayload) {
  chatRealtimeEmitter.emit(CHAT_CONVERSATION_UPDATED_EVENT, sanitizePayload(payload));
}