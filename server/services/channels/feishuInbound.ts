import { createHash } from "node:crypto";
import { isChatUserMessageTooLong } from "../../../shared/chatMessageContract";

export interface FeishuBinding {
  instanceId: string;
  ownerId: string;
  appId: string;
  botOpenId: string;
  allowedUsers: string[];
  allowedChats: string[];
}

export interface FeishuInbound {
  id: string;
  conversationKey: string;
  instanceId: string;
  ownerId: string;
  appId: string;
  messageId: string;
  chatId: string;
  chatType: "p2p" | "group";
  senderId: string;
  text: string;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function identifier(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : "";
}

function digest(parts: string[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** Accept only SDK-dispatched events from the connection belonging to this binding.
 * This parser is deliberately not a public webhook authentication boundary. */
export function parseFeishuInbound(binding: FeishuBinding, input: unknown): FeishuInbound | null {
  if (!binding.instanceId || !binding.ownerId || !identifier(binding.appId) || !identifier(binding.botOpenId)) return null;
  const data = record(input);
  const sender = record(data.sender);
  const message = record(data.message);
  const senderId = identifier(record(sender.sender_id).open_id);
  const chatId = identifier(message.chat_id);
  const messageId = identifier(message.message_id);
  if (sender.sender_type !== "user" || !senderId || senderId === binding.botOpenId || !chatId || !messageId) return null;
  // The first release requires an explicit user allowlist even in group chats.
  if (!binding.allowedUsers.includes(senderId)) return null;
  if (message.chat_type !== "p2p" && message.chat_type !== "group") return null;
  if (message.chat_type === "group" && !binding.allowedChats.includes(chatId)) return null;
  if (message.message_type !== "text" || typeof message.content !== "string" || message.content.length > 128 * 1024) return null;
  let content: Record<string, unknown>;
  try { content = record(JSON.parse(message.content)); } catch { return null; }
  if (typeof content.text !== "string") return null;
  let text = content.text;
  const mentions = Array.isArray(message.mentions) ? message.mentions.map(record) : [];
  const botMentions = mentions.filter(mention => record(mention.id).open_id === binding.botOpenId);
  if (message.chat_type === "group" && botMentions.length === 0) return null;
  for (const mention of botMentions) {
    if (typeof mention.key === "string" && /^@_user_\d+$/.test(mention.key)) text = text.split(mention.key).join("");
  }
  text = text.trim();
  if (!text || isChatUserMessageTooLong(text)) return null;
  return {
    id: digest([binding.appId, messageId]),
    // Sender isolation prevents another group member continuing or stopping a private run.
    conversationKey: digest([binding.ownerId, binding.instanceId, binding.appId, chatId, senderId]),
    instanceId: binding.instanceId, ownerId: binding.ownerId, appId: binding.appId,
    messageId, chatId, chatType: message.chat_type, senderId, text,
  };
}
