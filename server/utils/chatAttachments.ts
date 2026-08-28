import fs from "fs";
import path from "path";
import { getChatAttachmentConfig } from "../config/chatAttachmentConfig";
import { normalizeMultipartFilename } from "./multipartFilename";
import {
  resolveConversationAuthority,
  resolveConversationFilesAuthority,
  resolveInstanceAuthority,
  type ConversationAuthorityContext,
} from "../services/instances/resourceAuthorityService";

export const TEXT_ATTACHMENT_EXTENSIONS = new Set([".txt", ".md", ".csv", ".json", ".log"]);

export type ChatAttachmentRecord = {
  id: string;
  owner_id: string;
  instance_id: string;
  conversation_id: string;
  deleted_at?: string | null;
  original_name: string | null;
  filename: string | null;
  mime_type: string | null;
  size: number | null;
  storage_path: string | null;
};

export function buildChatAttachmentMetadata(files: ChatAttachmentRecord[]) {
  const attachments = (files || []).map((file) => ({
    id: file.id,
    originalName: getAttachmentDisplayName(file),
    mimeType: file.mime_type || "application/octet-stream",
    size: typeof file.size === "number" ? file.size : 0,
  }));
  return { attachmentIds: attachments.map((file) => file.id), attachments };
}

export function getAttachmentDisplayName(file: any): string {
  if (!file) return "unknown";
  return normalizeMultipartFilename(file.original_name || file.filename || "unknown");
}

export function getAttachmentExtension(file: any): string {
  const displayName = getAttachmentDisplayName(file);
  const ext = path.extname(displayName).toLowerCase();
  return ext || "";
}

export function isTextAttachment(file: any): boolean {
  return TEXT_ATTACHMENT_EXTENSIONS.has(getAttachmentExtension(file));
}

export function getUnsupportedDirectChatAttachments(files: any[]): any[] {
  return (files || []).filter((file) => !isTextAttachment(file));
}

export function buildUnsupportedDirectChatMessage(files: any[]): string {
  const names = files.map(getAttachmentDisplayName).join("、");
  return `Quick/Assist 模式只能读取 txt、md、csv、json、log 文本附件。以下附件当前无法直接解析：${names}。请切换 Agent 模式让 Hermes 使用工具读取，或改用支持多模态/文档解析的模型后再试。`;
}

export function isValidChatAttachmentId(val: any): boolean {
  return typeof val === "string" && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(val);
}

export function isChatAttachmentDeleted(file: Pick<ChatAttachmentRecord, "deleted_at">): boolean {
  const deletedAt = file?.deleted_at;
  return deletedAt !== undefined && deletedAt !== null && String(deletedAt).trim().length > 0;
}

export async function loadAndValidateChatAttachments(params: {
  attachmentIds?: any;
  userId: string;
  instanceId: string;
  conversationId: string;
  maxCount?: number | null;
  authority?: ConversationAuthorityContext;
}): Promise<ChatAttachmentRecord[]> {
  const { attachmentIds, userId, instanceId, conversationId } = params;
  const maxCount = params.maxCount === undefined ? getChatAttachmentConfig().maxFiles : params.maxCount;
  if (attachmentIds === undefined || attachmentIds === null) return [];
  if (!Array.isArray(attachmentIds)) {
    throw { status: 400, error: "INVALID_REQUEST", message: "attachmentIds must be an array." };
  }
  if (maxCount !== null && attachmentIds.length > maxCount) {
    throw { status: 400, error: "INVALID_REQUEST", message: `A message can include at most ${maxCount} attachments.` };
  }
  for (const fileId of attachmentIds) {
    if (!isValidChatAttachmentId(fileId)) {
      throw { status: 400, error: "INVALID_REQUEST", message: "Invalid attachment ID." };
    }
  }
  if (attachmentIds.length === 0) return [];
  if (new Set(attachmentIds).size !== attachmentIds.length) {
    throw { status: 400, error: "INVALID_REQUEST", message: "Duplicate attachment IDs are not allowed." };
  }

  let authority = params.authority;
  if (!authority) {
    const instance = await resolveInstanceAuthority({ actor: { kind: "user", id: userId }, instanceId });
    if (instance.ok === false) {
      throw { status: instance.status, error: instance.code, message: "Attachment authority validation failed." };
    }
    const conversation = await resolveConversationAuthority({ instance, conversationId });
    if (conversation.ok === false) {
      throw { status: conversation.status, error: conversation.code, message: "Attachment authority validation failed." };
    }
    authority = conversation;
  } else if (authority.ownerId !== userId
    || String(authority.instance.id) !== instanceId
    || String(authority.conversation.id) !== conversationId) {
    throw { status: 403, error: "FORBIDDEN", message: "Attachment authority context mismatch." };
  }

  const resolved = await resolveConversationFilesAuthority({ conversation: authority, fileIds: attachmentIds });
  if (resolved.ok === false) {
    throw { status: resolved.status, error: resolved.code, message: "One or more attachments do not exist." };
  }
  return resolved.files as ChatAttachmentRecord[];
}

export async function readAttachmentContent(file: any): Promise<{ content: string | null; error: string | null }> {
  const displayName = getAttachmentDisplayName(file);
  if (displayName === "unknown") {
    return { content: null, error: null };
  }

  if (!isTextAttachment(file)) {
    return { content: null, error: "UNSUPPORTED_CONTENT_PARSE" };
  }

  if (!file.storage_path) {
    return { content: null, error: "EMPTY_STORAGE_PATH" };
  }

  try {
    const rawContent = await fs.promises.readFile(file.storage_path, "utf8");
    if (rawContent === "") {
      return { content: "", error: null };
    }
    if (rawContent.length > 12000) {
      return { content: `${rawContent.substring(0, 12000)}\n\n[内容已截断]`, error: null };
    }
    return { content: rawContent, error: null };
  } catch {
    return { content: null, error: "ATTACHMENT_READ_FAILED" };
  }
}

export async function processAttachmentsForPrompt(validatedFiles: any[]): Promise<string> {
  if (!validatedFiles || validatedFiles.length === 0) return "";

  let attachmentContext = "【系统辅助信息】用户本轮上传了以下附件内容。仅根据可读取的文本内容辅助回答；无法读取的附件不要假装已经读取。\n\n";
  let totalContentLength = 0;
  const maxTotalLength = 24000;

  for (const file of validatedFiles) {
    const displayName = getAttachmentDisplayName(file);
    attachmentContext += `=== 附件: ${displayName} ===\n`;

    const { content, error } = await readAttachmentContent(file);

    if (error) {
      if (error === "UNSUPPORTED_CONTENT_PARSE") {
        attachmentContext += `该附件已上传，但 Quick/Assist 模式暂不支持内容解析。\n\n`;
      } else {
        attachmentContext += `[读取失败: ${error}]\n\n`;
      }
    } else if (content !== null && content !== undefined) {
      if (content === "") {
        attachmentContext += `[空文件]\n\n`;
      } else {
        const remainingLength = maxTotalLength - totalContentLength;
        if (remainingLength <= 0) {
          attachmentContext += `[超出总字符数限制，内容被忽略]\n\n`;
        } else if (content.length > remainingLength) {
          attachmentContext += `${content.substring(0, remainingLength)}\n\n[总内容已截断]\n\n`;
          totalContentLength += remainingLength;
        } else {
          attachmentContext += `${content}\n\n`;
          totalContentLength += content.length;
        }
      }
    } else {
      attachmentContext += `[空文件]\n\n`;
    }
  }

  return attachmentContext;
}

export function buildAgentAttachmentContextForPrompt(files: any[]): string {
  if (!files || files.length === 0) return "";

  const lines = files.map((file, index) => {
    const displayName = getAttachmentDisplayName(file);
    const storedName = file.filename || displayName;
    const containerPath = `/opt/data/chat_uploads/${file.conversation_id}/${storedName}`;
    const mime = file.mime_type || "unknown";
    const size = typeof file.size === "number" ? file.size : "unknown";
    return `${index + 1}. ${displayName}\n   - path: ${containerPath}\n   - mime: ${mime}\n   - size: ${size}`;
  });

  return `用户本轮上传了附件。请优先使用文件系统工具读取和分析这些文件；如果某类文件当前工具链无法解析，请明确说明限制，不要假装已经读取。\n\n${lines.join("\n")}`;
}
