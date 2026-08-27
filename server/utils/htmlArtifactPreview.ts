import crypto from "crypto";
import fs from "fs";
import path from "path";

export const HTML_ARTIFACT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
export const HTML_ARTIFACT_PREVIEW_TOKEN_TTL_MS = 10 * 60 * 1000;

export const HTML_ARTIFACT_PREVIEW_CSP = [
  "sandbox allow-scripts",
  "default-src 'none'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export const HTML_SINGLE_FILE_PREVIEW_CSP = [
  "sandbox allow-scripts",
  "default-src 'none'",
  "img-src data: blob:",
  "media-src data: blob:",
  "style-src 'unsafe-inline'",
  "font-src data:",
  "script-src 'unsafe-inline'",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export function isHtmlArtifactPreview(filePath: string, mimeType = ""): boolean {
  return /\.html?$/i.test(filePath) || /(?:text|application)\/x?html/i.test(mimeType);
}

const ALLOWED_ASSET_EXTENSIONS = new Set([
  ".html", ".htm", ".css", ".js", ".mjs", ".json", ".map",
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif", ".ico", ".bmp",
  ".woff", ".woff2", ".ttf", ".otf",
  ".mp3", ".wav", ".ogg", ".mp4", ".mov", ".webm",
]);

export function isAllowedHtmlPreviewAsset(filePath: string): boolean {
  return ALLOWED_ASSET_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export type HtmlArtifactPreviewTokenPayload = {
  instanceId: string;
  ownerId: string;
  viewerRole: string;
  projectRoot: string;
  assetAliases?: Record<string, string>;
  expiresAt: number;
};

export type HtmlArtifactPreviewDependency = {
  reference: string;
  requestPath: string;
  resolvedPath: string | null;
  status: "ready" | "remapped" | "missing" | "unsupported";
};

export type HtmlArtifactPreviewInspection = {
  status: "ready" | "incomplete";
  dependencies: HtmlArtifactPreviewDependency[];
  missing: HtmlArtifactPreviewDependency[];
  aliases: Record<string, string>;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] || character);
}

export function renderHtmlArtifactPreviewDiagnostic(inspection: HtmlArtifactPreviewInspection): string {
  const rows = inspection.missing.map(item => `<li><code>${escapeHtml(item.reference)}</code><span>${escapeHtml(item.status)}</span></li>`).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HTML preview unavailable</title><style>body{margin:0;padding:32px;background:#f8fafc;color:#0f172a;font:14px/1.6 system-ui,sans-serif}.card{max-width:760px;margin:8vh auto;background:white;border:1px solid #e2e8f0;border-radius:16px;padding:24px;box-shadow:0 12px 36px #0f172a14}h1{font-size:18px;margin:0 0 8px}p{color:#475569}ul{padding:0;list-style:none}li{display:flex;justify-content:space-between;gap:16px;padding:10px 12px;margin:8px 0;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px}code{overflow-wrap:anywhere;color:#9a3412}span{color:#c2410c}</style></head><body><main class="card"><h1>HTML 项目尚未准备好 / Preview is not ready</h1><p>入口文件存在，但以下本地依赖缺失或不受支持。请让 Agent 补齐项目文件后重新加载。</p><ul>${rows}</ul></main></body></html>`;
}

const HTML_ASSET_REFERENCE_PATTERN = /<(?:script|link|img|source|video|audio)\b[^>]*?\b(?:src|href)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
const MAX_HTML_DEPENDENCIES = 128;
const MAX_HTML_PROJECT_SCAN_FILES = 2000;
const MAX_HTML_PROJECT_SCAN_DEPTH = 8;
const HTML_PROJECT_SCAN_SKIP_DIRECTORIES = new Set(["node_modules", ".git", ".cache", "__pycache__"]);

function normalizeLocalAssetReference(reference: string): string | null {
  const trimmed = reference.trim();
  if (!trimmed || trimmed.startsWith("#") || /^(?:data|blob|javascript|mailto|tel):/i.test(trimmed)) return null;
  const withoutSuffix = trimmed.split(/[?#]/, 1)[0];
  if (!withoutSuffix) return null;
  try {
    return decodeURIComponent(withoutSuffix).replace(/\\/g, "/");
  } catch {
    return withoutSuffix.replace(/\\/g, "/");
  }
}

export function extractHtmlArtifactAssetReferences(source: string): string[] {
  const references: string[] = [];
  const seen = new Set<string>();
  HTML_ASSET_REFERENCE_PATTERN.lastIndex = 0;
  for (const match of source.matchAll(HTML_ASSET_REFERENCE_PATTERN)) {
    const reference = normalizeLocalAssetReference(match[1] || match[2] || match[3] || "");
    if (!reference || seen.has(reference)) continue;
    seen.add(reference);
    references.push(reference);
    if (references.length >= MAX_HTML_DEPENDENCIES) break;
  }
  return references;
}

function isSafeRelativeAssetPath(value: string): boolean {
  if (!value || value.includes("\\") || path.posix.isAbsolute(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  return !value.split("/").some(segment => !segment || segment === "." || segment === "..");
}

function listProjectFiles(root: string): string[] {
  const files: string[] = [];
  const canonicalRoot = fs.realpathSync(path.resolve(root));
  const walk = (directory: string, depth: number) => {
    if (depth > MAX_HTML_PROJECT_SCAN_DEPTH || files.length >= MAX_HTML_PROJECT_SCAN_FILES) return;
    let entries: fs.Dirent[] = [];
    let canonicalDirectory = "";
    try {
      canonicalDirectory = fs.realpathSync(path.resolve(directory));
      if (canonicalDirectory !== canonicalRoot && !canonicalDirectory.startsWith(canonicalRoot + path.sep)) return;
      entries = fs.readdirSync(canonicalDirectory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_HTML_PROJECT_SCAN_FILES || entry.isSymbolicLink()) break;
      const absolutePath = path.join(canonicalDirectory, entry.name);
      if (entry.isDirectory() && !HTML_PROJECT_SCAN_SKIP_DIRECTORIES.has(entry.name)) walk(absolutePath, depth + 1);
      else if (entry.isFile()) files.push(path.relative(canonicalRoot, absolutePath).replace(/\\/g, "/"));
    }
  };
  walk(canonicalRoot, 0);
  return files;
}

export function inspectHtmlArtifactPreviewProject(input: {
  projectRootAbsolute: string;
  entryPath: string;
  source?: string;
}): HtmlArtifactPreviewInspection {
  const projectRootAbsolute = fs.realpathSync(path.resolve(input.projectRootAbsolute));
  const entryPath = input.entryPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!isSafeRelativeAssetPath(entryPath)) {
    throw Object.assign(new Error("HTML_PREVIEW_ENTRY_PATH_INVALID"), { code: "HTML_PREVIEW_ENTRY_PATH_INVALID", status: 400 });
  }
  const entryDirectory = path.posix.dirname(entryPath) === "." ? "" : path.posix.dirname(entryPath);
  const resolvedEntryAbsolute = path.resolve(projectRootAbsolute, ...entryPath.split("/"));
  if (resolvedEntryAbsolute !== projectRootAbsolute && !resolvedEntryAbsolute.startsWith(projectRootAbsolute + path.sep)) {
    throw Object.assign(new Error("HTML_PREVIEW_ENTRY_OUTSIDE_PROJECT"), { code: "HTML_PREVIEW_ENTRY_OUTSIDE_PROJECT", status: 403 });
  }
  const entryAbsolute = input.source === undefined ? fs.realpathSync(resolvedEntryAbsolute) : resolvedEntryAbsolute;
  if (entryAbsolute !== projectRootAbsolute && !entryAbsolute.startsWith(projectRootAbsolute + path.sep)) {
    throw Object.assign(new Error("HTML_PREVIEW_ENTRY_OUTSIDE_PROJECT"), { code: "HTML_PREVIEW_ENTRY_OUTSIDE_PROJECT", status: 403 });
  }
  const source = input.source ?? fs.readFileSync(entryAbsolute, "utf8");
  const projectFiles = listProjectFiles(projectRootAbsolute);
  const projectFileSet = new Set(projectFiles);
  const dependencies: HtmlArtifactPreviewDependency[] = [];
  const aliases: Record<string, string> = {};

  for (const reference of extractHtmlArtifactAssetReferences(source)) {
    const requestPath = path.posix.normalize(reference.startsWith("/")
      ? reference.replace(/^\/+/, "")
      : path.posix.join(entryDirectory, reference));
    if (!isSafeRelativeAssetPath(requestPath) || !isAllowedHtmlPreviewAsset(requestPath)) {
      dependencies.push({ reference, requestPath, resolvedPath: null, status: "unsupported" });
      continue;
    }
    if (projectFileSet.has(requestPath)) {
      dependencies.push({ reference, requestPath, resolvedPath: requestPath, status: "ready" });
      continue;
    }

    const basename = path.posix.basename(requestPath).toLowerCase();
    const matching = projectFiles.filter(candidate => path.posix.basename(candidate).toLowerCase() === basename);
    const preferred = [
      path.posix.join(entryDirectory, "preview", reference),
      path.posix.join("preview", reference),
      path.posix.join(entryDirectory, "dist", reference),
      path.posix.join("dist", reference),
      path.posix.join(entryDirectory, "build", reference),
      path.posix.join("build", reference),
    ].map(candidate => path.posix.normalize(candidate).replace(/^\/+/, ""));
    const preferredExisting = preferred.find(candidate => {
      if (!isSafeRelativeAssetPath(candidate) || !isAllowedHtmlPreviewAsset(candidate)) return false;
      try {
        const candidateAbsolute = fs.realpathSync(path.resolve(projectRootAbsolute, ...candidate.split("/")));
        if (candidateAbsolute !== projectRootAbsolute && !candidateAbsolute.startsWith(projectRootAbsolute + path.sep)) return false;
        const stats = fs.lstatSync(candidateAbsolute);
        return stats.isFile() && !stats.isSymbolicLink();
      } catch {
        return false;
      }
    });
    const resolvedPath = preferredExisting
      || (matching.length === 1 ? matching[0] : null);
    if (resolvedPath && isSafeRelativeAssetPath(resolvedPath) && isAllowedHtmlPreviewAsset(resolvedPath)) {
      aliases[requestPath] = resolvedPath;
      dependencies.push({ reference, requestPath, resolvedPath, status: "remapped" });
    } else {
      dependencies.push({ reference, requestPath, resolvedPath: null, status: "missing" });
    }
  }

  const missing = dependencies.filter(item => item.status === "missing" || item.status === "unsupported");
  return { status: missing.length > 0 ? "incomplete" : "ready", dependencies, missing, aliases };
}

function encodePayload(payload: HtmlArtifactPreviewTokenPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function signPayload(encodedPayload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function normalizeHtmlPreviewProjectRoot(requestedPath: string): { projectRoot: string; entryPath: string } | null {
  const normalized = requestedPath.replace(/^\/+/, "");
  if (!normalized || normalized.includes("\\")) return null;
  const segments = normalized.split("/");
  if (segments.some(segment => !segment || segment === "." || segment === "..")) return null;
  if (segments[0]?.toLowerCase() === "outputs" && segments.length >= 4) {
    return {
      projectRoot: segments.slice(0, 3).join("/"),
      entryPath: segments.slice(3).join("/"),
    };
  }
  const projectRoot = path.posix.dirname(normalized);
  return { projectRoot, entryPath: path.posix.basename(normalized) };
}

export function createHtmlArtifactPreviewToken(input: {
  instanceId: string;
  ownerId: string;
  viewerRole: string;
  projectRoot: string;
  assetAliases?: Record<string, string>;
  secret: string;
  now?: number;
}): string {
  const payload = encodePayload({
    instanceId: input.instanceId,
    ownerId: input.ownerId,
    viewerRole: input.viewerRole,
    projectRoot: input.projectRoot,
    assetAliases: input.assetAliases,
    expiresAt: (input.now ?? Date.now()) + HTML_ARTIFACT_PREVIEW_TOKEN_TTL_MS,
  });
  return `${payload}.${signPayload(payload, input.secret)}`;
}

export function verifyHtmlArtifactPreviewToken(token: string, secret: string, now = Date.now()): HtmlArtifactPreviewTokenPayload | null {
  const [encodedPayload, signature, ...rest] = token.split(".");
  if (!encodedPayload || !signature || rest.length > 0) return null;
  const expected = signPayload(encodedPayload, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as HtmlArtifactPreviewTokenPayload;
    if (!payload.instanceId || !payload.ownerId || !payload.viewerRole || !payload.projectRoot || !Number.isFinite(payload.expiresAt)) return null;
    if (payload.assetAliases && (typeof payload.assetAliases !== "object" || Array.isArray(payload.assetAliases))) return null;
    if (payload.assetAliases && Object.entries(payload.assetAliases).some(([from, to]) => !isSafeRelativeAssetPath(from) || !isSafeRelativeAssetPath(to))) return null;
    if (payload.expiresAt <= now) return null;
    return payload;
  } catch {
    return null;
  }
}
