import { randomUUID } from "node:crypto";
import { mutateStoreCollections, nowIso, readStoreCollections } from "../localStore";
import type { FeishuInbound } from "../services/channels/feishuInbound";

export interface ChannelMessage extends FeishuInbound {
  conversationId: string;
  status: "received" | "submitted" | "finished";
  runId: string | null;
  createdAt: string;
  replies?: Array<{ id: string; text: string; sent: boolean }>;
}

export const channelMessagesRepo = {
  /** Commit before acknowledging the SDK event. Duplicate deliveries never create
   * another conversation or change the original message content. */
  receive(message: FeishuInbound): { replayed: boolean; receipt: ChannelMessage } {
    return mutateStoreCollections(["channelMessages", "conversations", "instances"] as const, data => {
      const instance = data.instances.find(row => row.id === message.instanceId);
      if (!instance || (instance.user_id || instance.owner_id) !== message.ownerId
        || (instance.user_id && instance.owner_id && instance.user_id !== instance.owner_id)
        || !["pi", "codex"].includes(instance.runtime_type)) throw new Error("CHANNEL_INSTANCE_UNAVAILABLE");
      const existing: ChannelMessage | undefined = data.channelMessages.find(row => row.id === message.id);
      if (existing) {
        if (existing.instanceId !== message.instanceId || existing.ownerId !== message.ownerId
          || existing.conversationKey !== message.conversationKey || existing.text !== message.text) {
          throw new Error("CHANNEL_MESSAGE_CONFLICT");
        }
        return { replayed: true, receipt: existing };
      }
      // Bound pending work per instance; overload must not be acknowledged as accepted.
      if (data.channelMessages.filter(row => row.instanceId === message.instanceId && row.status !== "finished").length >= 100) {
        throw new Error("CHANNEL_QUEUE_FULL");
      }
      let conversation = data.conversations.find(row => row.channel_key === message.conversationKey
        && row.user_id === message.ownerId && row.instance_id === message.instanceId);
      const now = nowIso();
      if (!conversation) {
        conversation = {
          id: randomUUID(), user_id: message.ownerId, instance_id: message.instanceId,
          title: "Feishu", session_id: null, project_id: null, pinned_at: null,
          channel_key: message.conversationKey, channel: "feishu",
          created_at: now, updated_at: now, last_message_at: now,
        };
        data.conversations.push(conversation);
      }
      const receipt: ChannelMessage = { ...message, conversationId: conversation.id, status: "received", runId: null, createdAt: now };
      data.channelMessages.push(receipt);
      return { replayed: false, receipt };
    });
  },

  pending(instanceId: string): ChannelMessage[] {
    return readStoreCollections(["channelMessages"]).channelMessages
      .filter(row => row.instanceId === instanceId && row.status !== "finished");
  },

  update(id: string, updates: Partial<Pick<ChannelMessage, "status" | "runId" | "replies">>) {
    return mutateStoreCollections(["channelMessages"], data => {
      const row = data.channelMessages.find(candidate => candidate.id === id);
      if (!row) throw new Error("CHANNEL_MESSAGE_NOT_FOUND");
      Object.assign(row, updates);
    });
  },
};
