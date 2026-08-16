import fs from "fs";
import path from "path";

const TEXT_FILE_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".csv", ".json", ".yaml", ".yml", ".log",
  ".html", ".htm", ".xml", ".ini", ".conf", ".cfg",
]);

const BLOCKED_ARCHIVE_EXTENSIONS = new Set([
  ".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar",
]);

const SENSITIVE_NAME_PATTERNS = [
  /^\.env(?:\.|$)/i,
  /(^|[._-])(secret|secrets|credential|credentials|password|passwd|token|session|cookie|private|apikey|api[-_]?key|access[-_]?key)([._-]|$)/i,
  /(^|[._-])(id_rsa|id_dsa|known_hosts)([._-]|$)/i,
  /\.(?:key|pem|p12|pfx|jks|crt|der)$/i,
  /(?:config|settings)\.(?:ya?ml|json)$/i,
  /(?:\.sqlite|\.sqlite3|\.db)$/i,
  /^\.git(?:$|[\\/])/i,
];

const SECRET_CONTENT_PATTERNS = [
  /-----BEGIN[^\r\n]*PRIVATE KEY-----/i,
  /\b(?:sk|rk)-[A-Za-z0-9]{20,}\b/i,
  /\b(?:ghp|gho|github_pat|xoxb|xapp|AKIA)[A-Za-z0-9_-]{12,}\b/i,
  /\b(?:api[-_]?key|access[-_]?key|secret(?:[-_]?key)?|token|password|passwd|private[-_]?key)\s*[:=]\s*["']?[A-Za-z0-9_./+=:-]{12,}/i,
];

export type FileLeakGuardResult =
  | { ok: true; realPath: string }
  | { ok: false; code: string; error: string; status: 400 | 403 | 404 };

export function isBlockedExportFileName(fileName: string): boolean {
  const normalized = String(fileName || "").replace(/\\/g, "/");
  const baseName = path.posix.basename(normalized).toLowerCase();
  if (!baseName) return true;
  if (BLOCKED_ARCHIVE_EXTENSIONS.has(path.posix.extname(baseName))) return true;
  return SENSITIVE_NAME_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function containsSecretContent(content: string): boolean {
  return SECRET_CONTENT_PATTERNS.some((pattern) => pattern.test(content));
}

function isTextFile(fileName: string): boolean {
  return TEXT_FILE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

async function containsSecretInTextFile(filePath: string): Promise<boolean> {
  const stream = fs.createReadStream(filePath, { encoding: "utf8", highWaterMark: 64 * 1024 });
  let carry = "";

  try {
    for await (const chunk of stream) {
      const text = carry + String(chunk);
      if (containsSecretContent(text)) return true;
      carry = text.slice(-8192);
    }
    return false;
  } finally {
    stream.destroy();
  }
}

export async function guardFileExport(filePath: string, displayName = path.basename(filePath)): Promise<FileLeakGuardResult> {
  if (isBlockedExportFileName(displayName) || isBlockedExportFileName(filePath)) {
    return { ok: false, code: "FILE_EXPORT_BLOCKED", error: "出于安全原因，该文件不允许预览或导出。", status: 403 };
  }

  let realPath: string;
  try {
    const linkStats = fs.lstatSync(filePath);
    if (linkStats.isSymbolicLink()) {
      return { ok: false, code: "FILE_SYMLINK_BLOCKED", error: "出于安全原因，不允许导出符号链接文件。", status: 403 };
    }
    if (!fs.statSync(filePath).isFile()) {
      return { ok: false, code: "FILE_NOT_REGULAR", error: "只能预览或导出普通文件。", status: 400 };
    }
    realPath = fs.realpathSync(filePath);
  } catch {
    return { ok: false, code: "FILE_NOT_FOUND", error: "文件不存在或已无法访问。", status: 404 };
  }

  if (isTextFile(displayName) && await containsSecretInTextFile(realPath)) {
    return { ok: false, code: "FILE_SECRET_CONTENT_BLOCKED", error: "检测到文件内容可能包含密钥或密码，已禁止预览和导出。", status: 403 };
  }

  return { ok: true, realPath };
}
