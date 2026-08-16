export const MAX_CHAT_USER_MESSAGE_CHARS = 20_000;
export const CHAT_CONTEXT_CHAR_BUDGET = 48_000;
export const CHAT_CONTEXT_MESSAGE_LIMIT = 20;
export const STANDARD_API_JSON_BODY_LIMIT = "512kb";
export const STANDARD_API_JSON_BODY_LIMIT_BYTES = 512 * 1024;

export function countChatMessageCharacters(value: string): number {
  return Array.from(value || "").length;
}

export function isChatUserMessageTooLong(value: string): boolean {
  return countChatMessageCharacters(value.trim()) > MAX_CHAT_USER_MESSAGE_CHARS;
}

export function chatUserMessageLimitMessage(max = MAX_CHAT_USER_MESSAGE_CHARS): string {
  return `单条消息最多支持 ${max.toLocaleString("zh-CN")} 字符，请拆分内容或作为文件上传。`;
}

const CONTEXT_TRUNCATION_MARKER = "\n…[truncated for context]…\n";

export function truncateMessageForContext(value: string, maxChars: number): string {
  const characters = Array.from(value || "");
  if (characters.length <= maxChars) return value || "";
  if (maxChars <= 0) return "";

  const marker = Array.from(CONTEXT_TRUNCATION_MARKER);
  if (maxChars < marker.length + 2) return "";

  const available = maxChars - marker.length;
  const headLength = Math.ceil(available / 2);
  const tailLength = Math.floor(available / 2);
  return [...characters.slice(0, headLength), ...marker, ...characters.slice(characters.length - tailLength)].join("");
}

export function selectRecentMessagesForContext<T extends { content?: string | null }>(
  messages: T[],
  maxChars = CHAT_CONTEXT_CHAR_BUDGET
): T[] {
  if (!Array.isArray(messages) || messages.length === 0 || maxChars <= 0) return [];

  const result: T[] = [];
  let totalChars = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const content = message.content || "";
    const contentLength = countChatMessageCharacters(content);
    const remaining = maxChars - totalChars;
    if (remaining <= 0) break;
    if (contentLength <= remaining) {
      result.unshift(message);
      totalChars += contentLength;
      continue;
    }
    const truncatedContent = truncateMessageForContext(content, remaining);
    if (truncatedContent) result.unshift({ ...message, content: truncatedContent });
    break;
  }
  return result;
}