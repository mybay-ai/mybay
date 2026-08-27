import { Router, Response } from "express";
import { AuthenticatedRequest, authenticateToken } from "../../middlewares/auth";
import { dbAdapter } from "../../db";
import { parseTraefikEnv } from "../../infrastructure/traefik/traefikConfig";
import fs from "fs";
import path from "path";
import { executeDeployment, buildDeploymentContext, rebuildProxyConfig } from "../../deployment";
import { getDirectorySizeBytes } from "../../utils/storageQuota";
import { isQuotaConsumingStatus, resolveInstanceLimit } from "../../utils/quota";
import { parseCpuToNum, parseMemoryToMb, formatMemoryStr, resolveResourceLimitsForInstance } from "../../utils/instances/instanceResourceLimits";
import { instanceSensitiveFields } from "../../utils/instances/instanceSensitiveFields";
import { validateInstancePathForDeletion } from "../../utils/instances/instancePathUtils";
import { checkLimitOrSkipAdmin } from "./create.routes"; // Import from create if needed
import { RouterDependencies, invalidateContainerStatsCache } from "./index";
import { parseImageRef, upload } from "./helpers";
import { encrypt } from "../../crypto";
import bcrypt from "bcryptjs";
import { findAvailablePort } from "../../utils";
import { execFile } from "child_process";
import { runInstanceHealthChecks } from "../../healthCheck";
import { startPeriodicAgentDbSync } from "../../sqliteAgentSync";
import { isSensitiveFile, getMimeType, validateFileAccess, validateFileForDeletion } from "../../services/instances/instanceFileSecurityService";
import { guardFileExport } from "../../services/instances/instanceFileLeakGuard";
import { validateUploadedFilePath } from "../../utils/uploadSecurity";
import { checkInstanceStorageQuota, resolveInstanceDiskLimitMb, formatDiskLimitLabel } from "../../services/instances/instanceStorageQuotaService";
import { sanitizeErrorMessage } from "../../utils/sanitizer";
import { buildFileContentDisposition } from "../../utils/fileResponseHeaders";
import { DEFAULT_USER_DISK_LIMIT_MB } from "../../constants/resourceLimits";
import {
  createHtmlArtifactPreviewToken,
  HTML_ARTIFACT_PREVIEW_CSP,
  HTML_ARTIFACT_PREVIEW_MAX_BYTES,
  isAllowedHtmlPreviewAsset,
  isHtmlArtifactPreview,
  inspectHtmlArtifactPreviewProject,
  normalizeHtmlPreviewProjectRoot,
  renderHtmlArtifactPreviewDiagnostic,
  verifyHtmlArtifactPreviewToken,
} from "../../utils/htmlArtifactPreview";
import { JWT_SECRET } from "../../utils/authSecrets";
import { renderLocalOfficePreview } from "../../utils/officeArtifactPreview";
import { streamLocalVideo } from "../../utils/mediaStream";
import { createLocalGeneratedArtifactSnapshot } from "../../utils/localGeneratedArtifactLifecycle";
import rateLimit from "express-rate-limit";
import { getClientIp } from "../../utils/ip";


type FileUsageCategory = "document" | "spreadsheet" | "image" | "web" | "log" | "archive" | "cache" | "other";

const instanceFileReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  keyGenerator: (req: AuthenticatedRequest) => `instance_file_read:ip:${getClientIp(req)}:user:${req.user?.id || "anon"}`,
  message: {
    error: "文件读取请求过于频繁，请稍后重试。",
    code: "INSTANCE_FILE_RATE_LIMITED",
  },
});

const htmlPreviewAssetLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  keyGenerator: (req: AuthenticatedRequest) => `html_preview_asset:ip:${getClientIp(req)}`,
  message: {
    error: "HTML 预览资源请求过于频繁，请稍后重试。",
    code: "HTML_PREVIEW_ASSET_RATE_LIMITED",
  },
});

type FileUsageEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  updatedAt: string;
  category: FileUsageCategory;
  deletable: boolean;
  reasonCode?: "large_file" | "old_file" | "cache_or_log" | "generated_output";
};

const FILE_USAGE_ALLOWED_DELETE_PREFIXES = ["outputs/", "uploads/", "documents/", "reports/", "tmp/"];
const FILE_USAGE_SKIP_DIRS = new Set([".git", "node_modules", "__pycache__", ".cache"]);
const FILE_USAGE_MAX_FILES = 5000;
const FILE_USAGE_MAX_DEPTH = 8;

function toVirtualPath(rootDir: string, absolutePath: string) {
  const rel = path.relative(rootDir, absolutePath).replace(/\\/g, "/");
  return "/" + rel.replace(/^\/+/, "");
}

function isUsageDeletable(virtualPath: string, fileName: string) {
  if (!virtualPath || virtualPath === "/") return false;
  if (fileName.startsWith(".") || isSensitiveFile(fileName)) return false;
  const normalized = virtualPath.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
  return FILE_USAGE_ALLOWED_DELETE_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

function getUsageCategory(fileName: string, virtualPath: string, mime: string): FileUsageCategory {
  const ext = path.extname(fileName).toLowerCase();
  const normalized = virtualPath.toLowerCase();
  if (normalized.includes("/cache/") || normalized.includes("/tmp/") || normalized.startsWith("/tmp/")) return "cache";
  if ([".log", ".out", ".err"].includes(ext)) return "log";
  if ([".md", ".txt", ".pdf", ".doc", ".docx"].includes(ext)) return "document";
  if ([".xls", ".xlsx", ".csv", ".tsv"].includes(ext)) return "spreadsheet";
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].includes(ext) || mime.startsWith("image/")) return "image";
  if ([".html", ".htm"].includes(ext)) return "web";
  if ([".zip", ".tar", ".gz", ".7z", ".rar"].includes(ext)) return "archive";
  return "other";
}

function getUsageReason(entry: FileUsageEntry, nowMs: number) {
  const ageDays = (nowMs - new Date(entry.updatedAt).getTime()) / 86400000;
  if (entry.category === "cache" || entry.category === "log") return "cache_or_log";
  if (entry.size >= 50 * 1024 * 1024) return "large_file";
  if (["web", "document", "spreadsheet", "image"].includes(entry.category)) return "generated_output";
  if (ageDays >= 14) return "old_file";
  return undefined;
}

function scanInstanceUsage(rootDir: string) {
  const topFiles: FileUsageEntry[] = [];
  const recentFiles: FileUsageEntry[] = [];
  const recommendations: FileUsageEntry[] = [];
  const folderSizeMap = new Map<string, FileUsageEntry>();
  const categorySizeMap = new Map<FileUsageCategory, number>();
  const nowMs = Date.now();
  let totalBytes = 0;
  let scannedFiles = 0;
  let truncated = false;

  const rememberFile = (entry: FileUsageEntry) => {
    topFiles.push(entry);
    topFiles.sort((a, b) => b.size - a.size);
    if (topFiles.length > 20) topFiles.pop();

    recentFiles.push(entry);
    recentFiles.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    if (recentFiles.length > 20) recentFiles.pop();

    const reasonCode = getUsageReason(entry, nowMs);
    if (entry.deletable && reasonCode) {
      recommendations.push({ ...entry, reasonCode });
      recommendations.sort((a, b) => b.size - a.size);
      if (recommendations.length > 20) recommendations.pop();
    }
  };

  const walk = (dir: string, depth: number): number => {
    if (scannedFiles >= FILE_USAGE_MAX_FILES) {
      truncated = true;
      return 0;
    }
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return 0;
    }

    let dirSize = 0;
    for (const entry of entries) {
      if (scannedFiles >= FILE_USAGE_MAX_FILES) {
        truncated = true;
        break;
      }
      if (isSensitiveFile(entry.name)) continue;
      const absolutePath = path.join(dir, entry.name);
      const virtualPath = toVirtualPath(rootDir, absolutePath);

      try {
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (depth >= FILE_USAGE_MAX_DEPTH || FILE_USAGE_SKIP_DIRS.has(entry.name.toLowerCase())) {
            truncated = true;
            continue;
          }
          const size = walk(absolutePath, depth + 1);
          dirSize += size;
          if (depth === 0 || size >= 1024 * 1024) {
            const stats = fs.statSync(absolutePath);
            folderSizeMap.set(virtualPath, {
              name: entry.name,
              path: virtualPath,
              type: "directory",
              size,
              updatedAt: stats.mtime.toISOString(),
              category: getUsageCategory(entry.name, virtualPath, ""),
              deletable: false
            });
          }
          continue;
        }
        if (!entry.isFile()) continue;

        const stats = fs.statSync(absolutePath);
        scannedFiles += 1;
        totalBytes += stats.size;
        dirSize += stats.size;
        const mime = getMimeType(entry.name);
        const category = getUsageCategory(entry.name, virtualPath, mime);
        categorySizeMap.set(category, (categorySizeMap.get(category) || 0) + stats.size);
        rememberFile({
          name: entry.name,
          path: virtualPath,
          type: "file",
          size: stats.size,
          updatedAt: stats.mtime.toISOString(),
          category,
          deletable: isUsageDeletable(virtualPath, entry.name)
        });
      } catch (e) {
        continue;
      }
    }
    return dirSize;
  };

  walk(rootDir, 0);

  const folders = Array.from(folderSizeMap.values())
    .filter(item => item.size > 0)
    .sort((a, b) => b.size - a.size)
    .slice(0, 12);

  const categories = Array.from(categorySizeMap.entries())
    .map(([category, size]) => ({ category, size }))
    .sort((a, b) => b.size - a.size);

  return {
    totalBytes,
    scannedFiles,
    truncated,
    folders,
    topFiles,
    recentFiles,
    recommendations,
    categories
  };
}

export function createFilesRoutes(deps: RouterDependencies) {
  const router = Router();
  const { io, wrappedUpdateStatus, docker, setupSessionMap, containerStatsCache } = deps;

  router.use([
    "/:id/files/office-preview",
    "/:id/files/metadata",
    "/:id/files/html-preview",
    "/:id/files/download",
    "/:id/files/media-preview",
  ], instanceFileReadLimiter);
  router.use("/:id/files/html-preview-assets/:token/*", htmlPreviewAssetLimiter);

  const inspectHtmlPreview = async (req: AuthenticatedRequest, requestedPath: string, entryRealPath: string) => {
    const project = normalizeHtmlPreviewProjectRoot(requestedPath);
    if (!project) return null;
    const projectPath = project.projectRoot === "." ? "/" : project.projectRoot;
    const projectValidation = await validateFileAccess(req, req.params.id, projectPath);
    if ("error" in projectValidation) return null;
    const projectRootAbsolute = fs.realpathSync(projectValidation.absolutePath);
    const entryAbsolute = fs.realpathSync(entryRealPath);
    if (entryAbsolute !== projectRootAbsolute && !entryAbsolute.startsWith(projectRootAbsolute + path.sep)) return null;
    return {
      project,
      inspection: inspectHtmlArtifactPreviewProject({
        projectRootAbsolute,
        entryPath: project.entryPath,
      }),
    };
  };



  router.get("/:id/files/usage", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance = await dbAdapter.getInstanceById(req.params.id);

      const validation = await validateFileAccess(req, req.params.id, "/");
      if ("error" in validation) {
        return res.status(validation.status).json({ error: validation.error });
      }

      const { rootDir, instance: validatedInstance } = validation;
      const usage = scanInstanceUsage(rootDir);
      const quota = await checkInstanceStorageQuota(validatedInstance, rootDir).catch(async () => {
        const resolvedLimitMb = await resolveInstanceDiskLimitMb(validatedInstance);
        return {
          storageUsedBytes: usage.totalBytes,
          storageLimitBytes: resolvedLimitMb === null ? null : resolvedLimitMb * 1024 * 1024,
          storageUsagePercent: resolvedLimitMb === null ? null : Math.round((usage.totalBytes / (resolvedLimitMb * 1024 * 1024)) * 1000) / 10,
          storageStatus: "unknown" as const,
          storageExceeded: false
        };
      });

      res.json({
        ok: true,
        root: "/",
        ...usage,
        quota
      });
    } catch (e: any) {
      res.status(500).json({ error: "文件占用分析失败: " + sanitizeErrorMessage(e.message) });
    }
  });

  router.get("/:id/files", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance = await dbAdapter.getInstanceById(req.params.id);
      const requestedPath = (req.query.path as string) || "/";
      const validation = await validateFileAccess(req, req.params.id, requestedPath);
      
      if ("error" in validation) {
        return res.status(validation.status).json({ error: validation.error });
      }

      const { absolutePath, rootDir } = validation;
      const stats = fs.statSync(absolutePath);

      if (!stats.isDirectory()) {
        return res.status(400).json({ error: "请求的路径不是一个目录" });
      }

      const files = fs.readdirSync(absolutePath);
      const items = files
        .filter(f => !isSensitiveFile(f))
        .map(f => {
          const fPath = path.join(absolutePath, f);
          const fStats = fs.lstatSync(fPath);
          const isSymlink = fStats.isSymbolicLink();
          let actualStats = fStats;
          if (isSymlink) {
            try {
               actualStats = fs.statSync(fPath);
            } catch(e) {
               actualStats = fStats; // fallback if broken link
            }
          }
          const virtualPath = path.join(requestedPath, f).replace(/\\/g, "/");
          
          return {
            name: f,
            path: virtualPath,
            type: actualStats.isDirectory() ? "directory" : "file",
            isSymlink,
            mime: actualStats.isDirectory() ? null : getMimeType(f),
            size: actualStats.isDirectory() ? null : actualStats.size,
            updatedAt: actualStats.mtime.toISOString()
          };
        });

      res.json({
        path: requestedPath.replace(/\\/g, "/"),
        items: items.sort((a, b) => {
          // Directories first, then alphabetical
          if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
          return a.name.localeCompare(b.name);
        })
      });
    } catch (e: any) {
      res.status(500).json({ error: "列表获取失败: " + sanitizeErrorMessage(e.message) });
    }
  });

  router.get("/:id/files/preview", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance = await dbAdapter.getInstanceById(req.params.id);
      const requestedPath = (req.query.path as string) || "";
      if (!requestedPath || requestedPath === "/") {
        return res.status(400).json({ error: "未指定文件路径" });
      }

      const validation = await validateFileAccess(req, req.params.id, requestedPath);
      
      if ("error" in validation) {
        return res.status(validation.status).json({ error: validation.error });
      }

      const { absolutePath } = validation;
      const exportGuard = await guardFileExport(absolutePath);
      if (exportGuard.ok === false) return res.status(exportGuard.status).json({ error: exportGuard.error, code: exportGuard.code });
      const safeAbsolutePath = exportGuard.realPath;

      const stats = fs.statSync(safeAbsolutePath);
      if (stats.isDirectory()) {
        return res.status(400).json({ error: "不能预览目录" });
      }

      const mime = getMimeType(safeAbsolutePath);
      const isImage = mime.startsWith("image/");
      const isText = mime.startsWith("text/") || [".json", ".yaml", ".yml", ".csv", ".log"].includes(path.extname(absolutePath).toLowerCase());

      if (isImage) {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:");
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        res.setHeader("Content-Type", mime);
        res.setHeader("Content-Disposition", buildFileContentDisposition(path.basename(safeAbsolutePath), "inline"));
        return res.sendFile(safeAbsolutePath, (error) => {
          if (!error) return;
          console.error(`[File Manager] Preview stream failed: ${safeAbsolutePath} -`, error);
          if (!res.headersSent) res.status(Number((error as any).statusCode) || 500).json({ error: "File preview transfer failed" });
          else res.destroy(error);
        });
      }

      if (isText) {
        const MAX_PREVIEW_SIZE = 1024 * 1024; // 1MB
        if (stats.size > MAX_PREVIEW_SIZE) {
          return res.status(400).json({ error: "文件过大，请下载查看", size: stats.size });
        }
        const content = fs.readFileSync(safeAbsolutePath, 'utf-8');
        return res.json({ content, mime, size: stats.size });
      }

      res.status(400).json({ error: "该文件类型暂不支持预览，请下载查看", mime });
    } catch (e: any) {
      res.status(500).json({ error: "预览失败: " + sanitizeErrorMessage(e.message) });
    }
  });

  // The read-only handlers below are protected by the path-scoped instanceFileReadLimiter.
  // lgtm[js/missing-rate-limiting]
  router.get("/:id/files/office-preview", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const requestedPath = (req.query.path as string) || "";
      if (!requestedPath || requestedPath === "/") {
        return res.status(400).json({ error: "未指定文件路径", code: "OFFICE_PREVIEW_PATH_REQUIRED" });
      }
      const validation = await validateFileAccess(req, req.params.id, requestedPath);
      if ("error" in validation) return res.status(validation.status).json({ error: validation.error, code: "OFFICE_PREVIEW_PATH_UNAVAILABLE" });
      const exportGuard = await guardFileExport(validation.absolutePath);
      if (exportGuard.ok === false) return res.status(exportGuard.status).json({ error: exportGuard.error, code: exportGuard.code });
      const preview = await renderLocalOfficePreview(exportGuard.realPath, path.basename(exportGuard.realPath));
      return res.json({ ok: true, ...preview });
    } catch (e: any) {
      const status = Number(e?.status) || 500;
      const code = String(e?.code || "OFFICE_PREVIEW_FAILED");
      return res.status(status).json({ error: code === "OFFICE_PREVIEW_TOO_LARGE" ? "Office 文件过大，请下载查看。" : "Office 文件预览失败，请下载后查看。", code });
    }
  });

  // lgtm[js/missing-rate-limiting]
  router.get("/:id/files/metadata", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const requestedPath = (req.query.path as string) || "";
      if (!requestedPath || requestedPath === "/") {
        return res.status(400).json({ error: "未指定文件路径", code: "FILE_METADATA_PATH_REQUIRED" });
      }
      const validation = await validateFileAccess(req, req.params.id, requestedPath);
      if ("error" in validation) {
        return res.status(validation.status).json({ error: validation.error, code: validation.status === 404 ? "FILE_NOT_FOUND" : "FILE_METADATA_FORBIDDEN" });
      }
      const exportGuard = await guardFileExport(validation.absolutePath);
      if (exportGuard.ok === false) {
        return res.status(exportGuard.status).json({ error: exportGuard.error, code: exportGuard.code });
      }
      // guardFileExport returns a canonical, regular, non-symlink file path.
      // lgtm[js/path-injection]
      const stats = fs.statSync(exportGuard.realPath);
      if (!stats.isFile()) {
        return res.status(400).json({ error: "请求的路径不是文件", code: "FILE_METADATA_NOT_FILE" });
      }
      const mime = getMimeType(exportGuard.realPath);
      const htmlPreview = isHtmlArtifactPreview(exportGuard.realPath, mime)
        ? await inspectHtmlPreview(req, requestedPath, exportGuard.realPath)
        : null;
      return res.json({
        ok: true,
        path: requestedPath.replace(/^\/+/, "").replace(/\\/g, "/"),
        name: path.basename(exportGuard.realPath),
        size: stats.size,
        mime,
        updatedAt: stats.mtime.toISOString(),
        artifact: createLocalGeneratedArtifactSnapshot({
          requestedPath,
          size: stats.size,
          modifiedAt: stats.mtime,
          htmlPreview: htmlPreview?.inspection,
        }),
      });
    } catch (e: any) {
      return res.status(500).json({ error: "文件状态检查失败: " + sanitizeErrorMessage(e.message), code: "FILE_METADATA_FAILED" });
    }
  });

  // lgtm[js/missing-rate-limiting]
  router.get("/:id/files/html-preview", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const requestedPath = (req.query.path as string) || "";
      if (!requestedPath || requestedPath === "/") {
        return res.status(400).json({ error: "未指定文件路径", code: "HTML_PREVIEW_PATH_REQUIRED" });
      }

      const validation = await validateFileAccess(req, req.params.id, requestedPath);
      if ("error" in validation) {
        return res.status(validation.status).json({ error: validation.error });
      }

      const exportGuard = await guardFileExport(validation.absolutePath);
      if (exportGuard.ok === false) {
        return res.status(exportGuard.status).json({ error: exportGuard.error, code: exportGuard.code });
      }

      // guardFileExport returns a canonical, regular, non-symlink file path.
      // lgtm[js/path-injection]
      const stats = fs.statSync(exportGuard.realPath);
      if (stats.isDirectory()) {
        return res.status(400).json({ error: "不能预览目录", code: "HTML_PREVIEW_DIRECTORY_UNSUPPORTED" });
      }

      const mime = getMimeType(exportGuard.realPath);
      if (!isHtmlArtifactPreview(exportGuard.realPath, mime)) {
        return res.status(415).json({ error: "该文件不是 HTML 文档", code: "HTML_PREVIEW_TYPE_UNSUPPORTED" });
      }
      if (stats.size > HTML_ARTIFACT_PREVIEW_MAX_BYTES) {
        return res.status(413).json({ error: "HTML 文件过大，请下载查看", code: "HTML_PREVIEW_TOO_LARGE", size: stats.size });
      }

      const preview = await inspectHtmlPreview(req, requestedPath, exportGuard.realPath);
      if (!preview) {
        return res.status(400).json({ error: "HTML 项目路径无效", code: "HTML_PREVIEW_PROJECT_PATH_INVALID" });
      }
      const { project, inspection } = preview;
      if (inspection.status === "incomplete") {
        res.status(422);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
        res.setHeader("X-MyBay-Preview-Status", "incomplete");
        return res.send(renderHtmlArtifactPreviewDiagnostic(inspection));
      }
      const token = createHtmlArtifactPreviewToken({
        instanceId: req.params.id,
        ownerId: String(req.user.id),
        viewerRole: String(req.user.role || "user"),
        projectRoot: project.projectRoot,
        assetAliases: inspection.aliases,
        secret: JWT_SECRET,
      });
      const encodedEntryPath = project.entryPath.split("/").map(encodeURIComponent).join("/");
      return res.redirect(302, `/api/instances/${encodeURIComponent(req.params.id)}/files/html-preview-assets/${token}/${encodedEntryPath}`);
    } catch (e: any) {
      return res.status(500).json({ error: "HTML 预览失败: " + sanitizeErrorMessage(e.message), code: "HTML_PREVIEW_FAILED" });
    }
  });

  // This capability route is protected by the path-scoped htmlPreviewAssetLimiter.
  // lgtm[js/missing-rate-limiting]
  router.get("/:id/files/html-preview-assets/:token/*", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const token = verifyHtmlArtifactPreviewToken(req.params.token, JWT_SECRET);
      if (!token || token.instanceId !== req.params.id) {
        return res.status(403).json({ error: "HTML 预览链接无效或已过期", code: "HTML_PREVIEW_TOKEN_INVALID" });
      }

      const assetPath = String(req.params[0] || "").replace(/^\/+/, "");
      const assetSegments = assetPath.split("/");
      if (!assetPath || assetPath.includes("\\") || assetSegments.some(segment => !segment || segment === "." || segment === "..")) {
        return res.status(400).json({ error: "HTML 资源路径无效", code: "HTML_PREVIEW_ASSET_PATH_INVALID" });
      }
      if (!isAllowedHtmlPreviewAsset(assetPath)) {
        return res.status(415).json({ error: "该资源类型不允许在 HTML 预览中加载", code: "HTML_PREVIEW_ASSET_TYPE_UNSUPPORTED" });
      }

      const capabilityRequest = {
        ...req,
        user: { id: token.ownerId, role: token.viewerRole },
      } as AuthenticatedRequest;
      const projectPath = token.projectRoot === "." ? "/" : token.projectRoot;
      const resolvedAssetPath = token.assetAliases?.[assetPath] || assetPath;
      const requestedAssetPath = path.posix.join(token.projectRoot, resolvedAssetPath);
      const projectValidation = await validateFileAccess(capabilityRequest, req.params.id, projectPath);
      if ("error" in projectValidation) {
        return res.status(projectValidation.status).json({ error: projectValidation.error, code: "HTML_PREVIEW_PROJECT_UNAVAILABLE" });
      }
      const assetValidation = await validateFileAccess(capabilityRequest, req.params.id, requestedAssetPath);
      if ("error" in assetValidation) {
        return res.status(assetValidation.status).json({ error: assetValidation.error, code: "HTML_PREVIEW_ASSET_UNAVAILABLE" });
      }

      const projectRoot = fs.realpathSync(projectValidation.absolutePath);
      const assetRealPath = fs.realpathSync(assetValidation.absolutePath);
      if (assetRealPath !== projectRoot && !assetRealPath.startsWith(projectRoot + path.sep)) {
        return res.status(403).json({ error: "HTML 资源超出项目目录", code: "HTML_PREVIEW_ASSET_OUTSIDE_PROJECT" });
      }
      const exportGuard = await guardFileExport(assetRealPath);
      if (exportGuard.ok === false) {
        return res.status(exportGuard.status).json({ error: exportGuard.error, code: exportGuard.code });
      }
      const stats = fs.statSync(exportGuard.realPath);
      if (stats.isDirectory()) {
        return res.status(400).json({ error: "不能加载目录资源", code: "HTML_PREVIEW_ASSET_DIRECTORY_UNSUPPORTED" });
      }
      if (stats.size > HTML_ARTIFACT_PREVIEW_MAX_BYTES) {
        return res.status(413).json({ error: "HTML 项目资源过大", code: "HTML_PREVIEW_ASSET_TOO_LARGE", size: stats.size });
      }

      const mime = getMimeType(exportGuard.realPath);
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Content-Type", isHtmlArtifactPreview(exportGuard.realPath, mime) ? "text/html; charset=utf-8" : mime);
      res.setHeader("Content-Disposition", buildFileContentDisposition(path.basename(exportGuard.realPath), "inline"));
      res.setHeader(
        "Content-Security-Policy",
        isHtmlArtifactPreview(exportGuard.realPath, mime)
          ? HTML_ARTIFACT_PREVIEW_CSP
          : "sandbox; default-src 'none'"
      );
      return res.sendFile(exportGuard.realPath, (error) => {
        if (!error) return;
        console.error("[File Manager] HTML asset stream failed", { filePath: exportGuard.realPath, error });
        if (!res.headersSent) res.status(Number((error as any).statusCode) || 500).json({ error: "HTML asset transfer failed", code: "HTML_PREVIEW_ASSET_TRANSFER_FAILED" });
        else res.destroy(error);
      });
    } catch (e: any) {
      return res.status(500).json({ error: "HTML 资源加载失败: " + sanitizeErrorMessage(e.message), code: "HTML_PREVIEW_ASSET_FAILED" });
    }
  });

  // lgtm[js/missing-rate-limiting]
  router.get("/:id/files/download", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance = await dbAdapter.getInstanceById(req.params.id);
      const requestedPath = (req.query.path as string) || "";
      if (!requestedPath || requestedPath === "/") {
        return res.status(400).json({ error: "未指定文件路径", code: "FILE_DOWNLOAD_PATH_REQUIRED" });
      }

      const validation = await validateFileAccess(req, req.params.id, requestedPath);
      
      if ("error" in validation) {
        return res.status(validation.status).json({ error: validation.error });
      }

      const { absolutePath } = validation;
      const exportGuard = await guardFileExport(absolutePath);
      if (exportGuard.ok === false) return res.status(exportGuard.status).json({ error: exportGuard.error, code: exportGuard.code });
      const safeAbsolutePath = exportGuard.realPath;

      const stats = fs.statSync(safeAbsolutePath);
      if (stats.isDirectory()) {
        return res.status(400).json({ error: "不能直接下载目录" });
      }

      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      res.setHeader("Content-Type", getMimeType(safeAbsolutePath));
      res.setHeader("Content-Disposition", buildFileContentDisposition(path.basename(safeAbsolutePath)));
      return res.sendFile(safeAbsolutePath, (error) => {
        if (!error) return;
        console.error("[File Manager] Download stream failed", { filePath: safeAbsolutePath, error });
        if (!res.headersSent) res.status(Number((error as any).statusCode) || 500).json({ error: "File download transfer failed" });
        else res.destroy(error);
      });
    } catch (e: any) {
      res.status(500).json({ error: "下载失败: " + sanitizeErrorMessage(e.message) });
    }
  });

  // lgtm[js/missing-rate-limiting]
  router.get("/:id/files/media-preview", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const requestedPath = (req.query.path as string) || "";
      if (!requestedPath || requestedPath === "/") {
        return res.status(400).json({ error: "未指定文件路径", code: "FILE_PREVIEW_PATH_REQUIRED" });
      }
      const validation = await validateFileAccess(req, req.params.id, requestedPath);
      if ("error" in validation) return res.status(validation.status).json({ error: validation.error });
      const exportGuard = await guardFileExport(validation.absolutePath);
      if (exportGuard.ok === false) return res.status(exportGuard.status).json({ error: exportGuard.error, code: exportGuard.code });
      return streamLocalVideo(req, res, exportGuard.realPath, path.basename(exportGuard.realPath));
    } catch (e: any) {
      return res.status(500).json({ error: "视频预览失败: " + sanitizeErrorMessage(e.message), code: "VIDEO_PREVIEW_FAILED" });
    }
  });

  router.delete("/:id/files", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const dbInst = await dbAdapter.getInstanceById(req.params.id);
      const bodyPath = req.body.path as string;
      const queryPath = req.query.path as string;
      if (bodyPath && queryPath && bodyPath !== queryPath) {
        return res.status(400).json({ error: "Path 参数不一致", code: "INVALID_PATH_PARAMS" });
      }
      const requestedPath = bodyPath || queryPath || "";
      if (!requestedPath || requestedPath === "/") {
        return res.status(400).json({ error: "未指定文件路径", code: "INVALID_FILE_PATH" });
      }

      const validation = await validateFileForDeletion(req, req.params.id, requestedPath);
      
      if ("error" in validation) {
        return res.status(validation.status as number).json({ error: validation.error, code: (validation as any).code });
      }

      const { absolutePath, rootDir, instance } = validation as any;

      // Perform deletion
      try {
        fs.unlinkSync(absolutePath);
      } catch (err: any) {
        if (err.code === 'ENOENT') {
           return res.status(404).json({ error: "文件不存在或已经被删除" });
        }
        if (err.code === 'EISDIR' || err.code === 'EPERM') {
           return res.status(403).json({ error: "无法删除：可能是一个目录或无权限" });
        }
        console.error(`[File Manager] Delete file error: ${absolutePath} -`, err);
        return res.status(500).json({ error: "文件删除失败: " + sanitizeErrorMessage(err.message) });
      }

      // Refresh storage stats
      let quota = {};
      try {
        quota = await checkInstanceStorageQuota(instance, rootDir);
        invalidateContainerStatsCache(req.params.id);
      } catch (qe) {
        // quiet fail for quota refresh
      }

      res.json({
        ok: true,
        deletedPath: requestedPath,
        ...quota
      });
    } catch (e: any) {
      res.status(500).json({ error: "服务器内部错误: " + sanitizeErrorMessage(e.message) });
    }
  });

  router.post("/:id/files/bulk-delete", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const dbInst = await dbAdapter.getInstanceById(req.params.id);
      const paths = req.body.paths;
      if (!Array.isArray(paths)) {
        return res.status(400).json({ error: "参数格式错误，paths 必须是数组", code: "INVALID_PARAMS" });
      }

      if (paths.length === 0) {
         return res.status(400).json({ error: "请选择要删除的文件", code: "EMPTY_PATHS" });
      }

      if (paths.length > 50) {
        return res.status(400).json({ error: "单次最多删除 50 个文件", code: "TOO_MANY_FILES" });
      }

      const deleted: string[] = [];
      const failed: { path: string, error: string }[] = [];
      
      let rootDirForStats = "";
      let instanceForStats: any = null;

      const filesToDelete: { requestedPath: string, absolutePath: string }[] = [];

      for (const requestedPath of paths) {
        if (!requestedPath || requestedPath === "/") {
            failed.push({ path: requestedPath, error: "未指定文件路径" });
            continue;
        }

        const validation = await validateFileForDeletion(req, req.params.id, requestedPath);
        
        if ("error" in validation) {
            if (validation.status === 403 || validation.status === 400) {
               return res.status(validation.status as number).json({ error: validation.error, code: (validation as any).code || "FORBIDDEN" });
            }
            failed.push({ path: requestedPath, error: validation.error });
            continue;
        }

        const { absolutePath, rootDir, instance } = validation as any;
        rootDirForStats = rootDir;
        instanceForStats = instance;
        filesToDelete.push({ requestedPath, absolutePath });
      }

      for (const file of filesToDelete) {
         try {
           fs.unlinkSync(file.absolutePath);
           deleted.push(file.requestedPath);
         } catch(e: any) {
           if (e.code === 'ENOENT') {
              failed.push({ path: file.requestedPath, error: "文件不存在" });
           } else if (e.code === 'EISDIR' || e.code === 'EPERM') {
              failed.push({ path: file.requestedPath, error: "无法删除：可能是一个目录或无权限" });
          } else {
             failed.push({ path: file.requestedPath, error: "删除操作失败: " + sanitizeErrorMessage(e.message) });
          }
         }
      }

      // Refresh storage stats if at least one file was deleted
      const resolvedLimitMb = instanceForStats ? await resolveInstanceDiskLimitMb(instanceForStats) : DEFAULT_USER_DISK_LIMIT_MB;
      let quota = {
        storageUsedBytes: null as number | null,
        storageLimitBytes: resolvedLimitMb === null ? null : resolvedLimitMb * 1024 * 1024,
        storageUsagePercent: null as number | null,
        storageStatus: "normal" as "normal" | "warning" | "exceeded" | "unknown",
        storageExceeded: false
      };

      if (deleted.length > 0 && rootDirForStats && instanceForStats) {
        quota = await checkInstanceStorageQuota(instanceForStats, rootDirForStats);
        invalidateContainerStatsCache(req.params.id);
        
        // Proactively clear storageExceeded flag if usage is back under safe threshold
        if (quota.storageUsagePercent !== null && quota.storageUsagePercent < 95 && !quota.storageExceeded) {
          try {
            let currentConfig: any = {};
            try {
              currentConfig = typeof instanceForStats.config_json === 'string' 
                ? JSON.parse(instanceForStats.config_json) 
                : (instanceForStats.config_json || {});
            } catch (e) {}
            
            if (currentConfig.storageExceeded) {
              currentConfig.storageExceeded = false;
              await dbAdapter.updateInstanceConfig(req.params.id, JSON.stringify(currentConfig)).catch(() => {});
              
              // Clear physical error to allow instant recovery
              await dbAdapter.updateInstancePhysicalState(req.params.id, {
                physical_status: 'exited',
                physical_error: null,
                last_reconciled_at: new Date().toISOString()
              }).catch(() => {});
              console.log(`[Files API] Storage returned to safe boundaries. Auto-cleared storageExceeded flag and physical errors for instance ${req.params.id}.`);
            }
          } catch (configErr: any) {
            console.error("[Files API Recovery Error] Failed to auto-clear storage flags:", configErr.message);
          }
        }
      }

      res.json({
        ok: true,
        deleted,
        failed,
        ...quota
      });
    } catch (e: any) {
      res.status(500).json({ error: "批量删除失败: " + sanitizeErrorMessage(e.message) });
    }
  });

  router.post("/:id/upload", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    if (!id || !/^[a-z0-9_-]+$/i.test(id)) {
      return res.status(400).json({ error: "非法实例 ID 参数" });
    }

    let existing: any = null;
    let rootDir = "";
    try {
      existing = await dbAdapter.getInstanceById(id);
      if (!existing) {
        return res.status(404).json({ error: "实例不存在" });
      }
      let isOwner = false;
      if (existing.owner_id) {
        isOwner = existing.owner_id === req.user.id;
      } else {
        isOwner = existing.user_id === req.user.id;
      }
      if (!isOwner && req.user.role !== 'admin') {
        return res.status(403).json({ error: "安全审计违规：您无权对此实例部署上传文件资源。" });
      }

      const localDir = path.resolve(process.cwd(), "data", "instances", id);
      rootDir = existing.data_volume_path || localDir;
      const quota = await checkInstanceStorageQuota(existing, rootDir);
      
      if (quota.storageExceeded || (quota.storageStatus === 'exceeded')) {
        const diskLimitMb = await resolveInstanceDiskLimitMb(existing);
        const limitLabel = formatDiskLimitLabel(diskLimitMb);
        return res.status(413).json({ error: `存储空间已超额 (${limitLabel} 上限)，禁止上传新文件。` });
      }

    } catch (e) {
      // safe fallback
    }

    upload(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ error: `文件上传或保存失败: ${sanitizeErrorMessage(err.message)}` });
      }
      if (!req.file) {
        return res.status(400).json({ error: "未接收到任何有效的多媒体上传文件内容，请重试。" });
      }
const uploadValidation = validateUploadedFilePath({
        filePath: req.file.path,
        originalName: req.file.originalname,
        declaredMime: req.file.mimetype,
        allowedExtensions: new Set([".pdf"]),
      });
      if (uploadValidation.ok === false) {
        try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(400).json({ error: uploadValidation.error, code: "INVALID_UPLOAD_CONTENT" });
      }
      req.file.mimetype = uploadValidation.mime;

      console.log(`[Instance File Resource Sync] Successfully uploaded '${req.file.originalname}' saved to isolated path: ${req.file.path}`);

      if (existing && rootDir) {
         let quotaAfter;
         try {
            quotaAfter = await checkInstanceStorageQuota(existing, rootDir);
         } catch (e: any) {
            console.error(`[Upload Quota Check] Failed to check quota after upload: ${e.message}`);
            try {
               fs.unlinkSync(req.file!.path);
            } catch (unlinkErr: any) {
               console.warn(`[Upload Quota Check] Failed to cleanup file after quota check error: ${unlinkErr.message}`);
            }
            return res.status(500).json({ error: "存储容量同步校验失败，未能确认配额，为了安全已撤销此文件的落盘保存，请稍后刷新重试！" });
         }

         if (quotaAfter.storageLimitBytes !== null && quotaAfter.storageUsedBytes !== null && quotaAfter.storageUsedBytes > quotaAfter.storageLimitBytes) {
             try {
                 fs.unlinkSync(req.file!.path);
             } catch (unlinkErr: any) {
                 console.error(`[Upload Quota Check] Failed to remove file after quota exceeded: ${unlinkErr.message}`);
             }
             const diskLimitMb = quotaAfter.storageLimitBytes !== null ? Math.round(quotaAfter.storageLimitBytes / (1024 * 1024)) : null;
             const limitLabel = formatDiskLimitLabel(diskLimitMb);
             return res.status(413).json({ error: `上传该文件后实例存储空间已超额 (${limitLabel} 上限)，禁止上传新文件。` });
         }
      }

      res.json({
        success: true,
        originalName: req.file.originalname,
        storedName: req.file.filename,
        storedSize: req.file.size,
        containerPath: `/opt/data/uploads/${req.file.filename}`
      });
    });
  });

  return router;
}
