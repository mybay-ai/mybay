import {
  DEFAULT_CHAT_ATTACHMENT_CONFIG,
  type ChatAttachmentConfig,
} from "../../shared/chatAttachmentContract";

function parseOptionalPositiveInteger(raw: string | undefined, fallback: number): number | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return fallback;
  if (["0", "unlimited", "none", "null"].includes(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseAllowedExtensions(raw: string | undefined): string[] | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return [...(DEFAULT_CHAT_ATTACHMENT_CONFIG.allowedExtensions || [])];
  if (["*", "all", "unlimited"].includes(value)) return null;
  const normalized = Array.from(new Set(value.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.startsWith(".") ? entry : `.${entry}`)
    .filter((entry) => /^\.[a-z0-9][a-z0-9._+-]{0,31}$/.test(entry))));
  return normalized.length > 0 ? normalized : [...(DEFAULT_CHAT_ATTACHMENT_CONFIG.allowedExtensions || [])];
}

export function getChatAttachmentConfig(env: NodeJS.ProcessEnv = process.env): ChatAttachmentConfig {
  const maxFileMb = parseOptionalPositiveInteger(
    env.CHAT_ATTACHMENT_MAX_FILE_MB,
    Math.round((DEFAULT_CHAT_ATTACHMENT_CONFIG.maxFileSizeBytes || 0) / (1024 * 1024))
  );
  return {
    maxFiles: parseOptionalPositiveInteger(env.CHAT_ATTACHMENT_MAX_FILES, DEFAULT_CHAT_ATTACHMENT_CONFIG.maxFiles || 20),
    maxFileSizeBytes: maxFileMb === null ? null : maxFileMb * 1024 * 1024,
    allowedExtensions: parseAllowedExtensions(env.CHAT_ATTACHMENT_ALLOWED_EXTENSIONS),
  };
}
