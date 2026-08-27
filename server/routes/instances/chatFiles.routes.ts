import { Router, Response } from "express";
import { AuthenticatedRequest, authenticateToken } from "../../middlewares/auth";
import multer from "multer";
import path from "path";
import fs from "fs";
import { dbAdapter } from "../../db";
import { chatRepo } from "../../repositories/chatRepo";
import { filesRepo } from "../../repositories/filesRepo";
import { guardFileExport } from "../../services/instances/instanceFileLeakGuard";
import { randomUUID } from "node:crypto";
import { validateUploadedFilePath } from "../../utils/uploadSecurity";
import { getChatAttachmentConfig } from "../../config/chatAttachmentConfig";
import { DEFAULT_CHAT_ATTACHMENT_CONFIG } from "../../../shared/chatAttachmentContract";
import { deleteChatAttachmentFile } from "../../services/chatAttachmentStorage";
import { checkInstanceStorageQuota, formatDiskLimitLabel, resolveInstanceDiskLimitMb } from "../../services/instances/instanceStorageQuotaService";
import {
  HTML_ARTIFACT_PREVIEW_MAX_BYTES,
  HTML_SINGLE_FILE_PREVIEW_CSP,
  isHtmlArtifactPreview,
} from "../../utils/htmlArtifactPreview";
import { renderLocalOfficePreview } from "../../utils/officeArtifactPreview";
import { normalizeMultipartFilename } from "../../utils/multipartFilename";
import { streamLocalVideo } from "../../utils/mediaStream";
import rateLimit from "express-rate-limit";
import { getClientIp } from "../../utils/ip";

const router = Router();

const chatFileReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  keyGenerator: (req: AuthenticatedRequest) => `chat_file_read:ip:${getClientIp(req)}:user:${req.user?.id || "anon"}`,
  message: {
    success: false,
    error: "CHAT_FILE_RATE_LIMITED",
    code: "CHAT_FILE_RATE_LIMITED",
    message: "文件读取请求过于频繁，请稍后重试。",
  },
});

const chatStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const { id, conversationId } = req.params;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id || "") || !/^[A-Za-z0-9_-]{1,128}$/.test(conversationId || "")) {
      return cb(new Error("Invalid instance or conversation identifier."), "");
    }
    const dir = path.join(process.cwd(), "data", "instances", id || "unknown", "chat_uploads", conversationId || "unknown");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const cleanName = `${randomUUID()}${ext}`;
    cb(null, cleanName);
  }
});

const chatAttachmentConfig = getChatAttachmentConfig();
const contentValidatedExtensions = new Set(DEFAULT_CHAT_ATTACHMENT_CONFIG.allowedExtensions || []);

function createChatUploadMiddleware() {
  const limits: { fileSize?: number; files?: number } = {};
  if (chatAttachmentConfig.maxFileSizeBytes !== null) limits.fileSize = chatAttachmentConfig.maxFileSizeBytes;
  if (chatAttachmentConfig.maxFiles !== null) limits.files = chatAttachmentConfig.maxFiles;
  const upload = multer({
    storage: chatStorage,
    limits,
    fileFilter: (_req, file, cb) => {
      file.originalname = normalizeMultipartFilename(file.originalname);
      const ext = path.extname(file.originalname).toLowerCase();
      const allowed = chatAttachmentConfig.allowedExtensions;
      if (!ext || (allowed !== null && !allowed.includes(ext))) {
        const label = allowed === null ? "带扩展名的文件" : allowed.join(", ");
        return cb(new Error(`不支持的文件类型。当前允许：${label}。`) as any, false);
      }
      cb(null, true);
    }
  });
  return chatAttachmentConfig.maxFiles === null
    ? upload.array("files")
    : upload.array("files", chatAttachmentConfig.maxFiles);
}

function getChatFileUrl(instanceId: string, conversationId: string, fileId: string, disposition = "attachment") {
  return `/api/instances/${encodeURIComponent(instanceId)}/conversations/${encodeURIComponent(conversationId)}/files/${encodeURIComponent(fileId)}/download?disposition=${encodeURIComponent(disposition)}`;
}

async function resolveChatFileForAccess(req: AuthenticatedRequest, res: Response) {
  const { id, conversationId, fileId } = req.params;
  const user = req.user!;

  const instance: any = await dbAdapter.getInstanceById(id);
  if (!instance) {
    res.status(404).json({ success: false, error: "INSTANCE_NOT_FOUND", message: "实例不存在。" });
    return null;
  }

  const isPrivileged = user.role === "admin" || user.role === "super_admin";
  if (instance.user_id !== user.id && !isPrivileged) {
    res.status(403).json({ success: false, error: "FORBIDDEN", message: "无权访问此实例。" });
    return null;
  }

  const ownerToUse = isPrivileged ? instance.user_id : user.id;
  const conv = await chatRepo.getConversationForOwnerAndInstance(ownerToUse, id, conversationId);
  if (!conv) {
    res.status(404).json({ success: false, error: "CONVERSATION_NOT_FOUND", message: "会话不存在或不属于当前实例。" });
    return null;
  }

  const data = await filesRepo.findById(fileId);

  if (!data) {
    res.status(404).json({ success: false, error: "FILE_NOT_FOUND", message: "文件不存在。" });
    return null;
  }
  if (data.instance_id !== id || data.conversation_id !== conversationId) {
    res.status(403).json({ success: false, error: "FORBIDDEN", message: "文件不属于当前会话。" });
    return null;
  }
  if (data.owner_id !== ownerToUse && !isPrivileged) {
    res.status(403).json({ success: false, error: "FORBIDDEN", message: "无权访问此文件。" });
    return null;
  }
  if (data.deleted_at) {
    res.status(410).json({ success: false, error: "FILE_DELETED", message: "文件已删除。" });
    return null;
  }

  const baseDir = path.resolve(process.cwd(), "data", "instances", id, "chat_uploads", conversationId);
  const storagePath = path.resolve(String(data.storage_path || ""));
  if (!storagePath || (!storagePath.startsWith(baseDir + path.sep) && storagePath !== baseDir)) {
    res.status(403).json({ success: false, error: "INVALID_FILE_PATH", message: "文件路径不在当前会话目录内。" });
    return null;
  }
  if (!fs.existsSync(storagePath)) {
    res.status(404).json({ success: false, error: "FILE_MISSING", message: "文件记录存在，但物理文件不存在。" });
    return null;
  }

  try {
    const realBaseDir = fs.realpathSync(baseDir);
    const realStoragePath = fs.realpathSync(storagePath);
    const isInside = realStoragePath.startsWith(realBaseDir + path.sep);
    if (!isInside || fs.lstatSync(storagePath).isSymbolicLink()) {
      res.status(403).json({ success: false, error: "INVALID_FILE_PATH", message: "文件路径未通过安全校验。" });
      return null;
    }
  } catch {
    res.status(404).json({ success: false, error: "FILE_MISSING", message: "文件记录存在，但物理文件不存在。" });
    return null;
  }

  return { file: data, storagePath };
}
function isFilesSchemaMismatch(error: any): boolean {
  const message = String(error?.message || error?.details || error?.hint || "");
  return (
    message.includes("schema cache") ||
    message.includes("column") ||
    message.includes("does not exist") ||
    message.includes("Could not find") ||
    message.includes("not found")
  );
}

router.get("/chat-files/config", authenticateToken, (_req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, config: chatAttachmentConfig });
});

router.post("/:id/conversations/:conversationId/files", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const { id, conversationId } = req.params;
  const user = req.user!;
  let instance: any = null;
  let instanceRootDir = "";

  try {
    instance = await dbAdapter.getInstanceById(id);
    if (!instance) {
      return res.status(404).json({ error: "实例不存在" });
    }
    const isPrivileged = user.role === "admin" || user.role === "super_admin";
    if (instance.user_id !== user.id && !isPrivileged) {
      return res.status(403).json({ error: "无权限访问此实例" });
    }

    // Check conversation ownership. Even if admin, check if the conversation belongs to the instance's owner and the instance itself.
    const ownerToUse = isPrivileged ? instance.user_id : user.id;
    const conv = await chatRepo.getConversationForOwnerAndInstance(ownerToUse, id, conversationId);
    if (!conv) {
      return res.status(404).json({ error: "会话不存在或不属于当前实例" });
    }
    instanceRootDir = instance.data_volume_path || path.resolve(process.cwd(), "data", "instances", id);
    const quota = await checkInstanceStorageQuota(instance, instanceRootDir);
    if (quota.storageExceeded || quota.storageStatus === "exceeded") {
      const limitLabel = formatDiskLimitLabel(await resolveInstanceDiskLimitMb(instance));
      return res.status(413).json({ code: "INSTANCE_STORAGE_QUOTA_EXCEEDED", error: "INSTANCE_STORAGE_QUOTA_EXCEEDED", message: `实例存储空间已超额 (${limitLabel} 上限)，禁止上传新附件。` });
    }
  } catch (err: any) {
    return res.status(500).json({ error: "验证权限失败: " + err.message });
  }

  createChatUploadMiddleware()(req, res, async (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        const maxMb = chatAttachmentConfig.maxFileSizeBytes === null ? null : Math.round(chatAttachmentConfig.maxFileSizeBytes / (1024 * 1024));
        return res.status(400).json({ error: maxMb === null ? "文件容量超出服务器可处理范围。" : `文件容量超出限制，单文件上限为 ${maxMb}MB。` });
      }
      if (err.code === "LIMIT_UNEXPECTED_FILE") {
        return res.status(400).json({ error: chatAttachmentConfig.maxFiles === null ? "附件数量超出服务器可处理范围。" : `当前消息最多上传 ${chatAttachmentConfig.maxFiles} 个附件。` });
      }
      return res.status(400).json({ error: err.message });
    }

    if (!req.files || (req.files as Express.Multer.File[]).length === 0) {
      return res.status(400).json({ error: "没有上传文件" });
    }

    const uploadedFiles = req.files as Express.Multer.File[];
    const configuredExtensions = chatAttachmentConfig.allowedExtensions;
    const validatedUploads = uploadedFiles.map((file) => {
      if (file.size === 0) return { ok: false as const, error: "Empty files are not allowed." };
      const ext = path.extname(file.originalname).toLowerCase();
      if (!contentValidatedExtensions.has(ext)) {
        const originalBase = path.basename(String(file.originalname || ""));
        if (!ext || !originalBase || originalBase !== file.originalname || /[\u0000-\u001f\u007f]/.test(originalBase)) {
          return { ok: false as const, error: "Invalid upload filename." };
        }
        return { ok: true as const, extension: ext, mime: file.mimetype || "application/octet-stream" };
      }
      return validateUploadedFilePath({
        filePath: file.path,
        originalName: file.originalname,
        declaredMime: file.mimetype,
        allowedExtensions: new Set(configuredExtensions || []),
      });
    });
    const invalidUpload = validatedUploads.find((result) => !result.ok);
    if (invalidUpload?.ok === false) {
      for (const file of uploadedFiles) if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(400).json({ error: invalidUpload.error, code: "INVALID_UPLOAD_CONTENT" });
    }
    validatedUploads.forEach((result, index) => {
      if (result.ok) uploadedFiles[index].mimetype = result.mime;
    });
    try {
      const quotaAfter = await checkInstanceStorageQuota(instance, instanceRootDir);
      if (quotaAfter.storageLimitBytes !== null && quotaAfter.storageUsedBytes !== null && quotaAfter.storageUsedBytes > quotaAfter.storageLimitBytes) {
        for (const file of uploadedFiles) if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        const limitMb = Math.round(quotaAfter.storageLimitBytes / (1024 * 1024));
        return res.status(413).json({ code: "INSTANCE_STORAGE_QUOTA_EXCEEDED", error: "INSTANCE_STORAGE_QUOTA_EXCEEDED", message: `上传后实例存储空间将超额 (${formatDiskLimitLabel(limitMb)} 上限)，已撤销本次附件上传。` });
      }
    } catch (quotaError: any) {
      for (const file of uploadedFiles) if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(500).json({ code: "ATTACHMENT_STORAGE_QUOTA_CHECK_FAILED", error: "ATTACHMENT_STORAGE_QUOTA_CHECK_FAILED", message: "存储容量校验失败，已撤销本次附件上传。" });
    }
    for (const file of uploadedFiles) {
      try {
        if (fs.existsSync(file.path)) {
          fs.chmodSync(path.dirname(file.path), 0o755);
          fs.chmodSync(file.path, 0o644);
        }
      } catch (chmodErr: any) {
        console.warn(`[Chat File Upload] Failed to relax permissions for Agent access: ${chmodErr?.message || chmodErr}`);
      }
    }
    const createdRecordIds: string[] = [];
    try {
      const records = [];
      for (const file of uploadedFiles) {
        const insertData = {
          owner_id: user.id,
          instance_id: id,
          conversation_id: conversationId,
          original_name: normalizeMultipartFilename(file.originalname),
          filename: file.filename,
          mime_type: file.mimetype,
          size: file.size,
          storage_path: file.path,
          deleted_at: null
        };

        const data = await filesRepo.create(insertData as any);
        createdRecordIds.push(data.id);

        records.push({
          id: data.id,
          originalName: normalizeMultipartFilename(data.original_name || data.filename),
          mimeType: data.mime_type,
          size: data.size,
          createdAt: data.created_at,
          downloadUrl: getChatFileUrl(id, conversationId, data.id),
          previewUrl: getChatFileUrl(id, conversationId, data.id, "inline")
        });
      }

      res.status(201).json({
        success: true,
        files: records
      });
    } catch (e: any) {
      await Promise.all(createdRecordIds.map((fileId) => filesRepo.delete(fileId).catch(() => {})));
      for (const file of uploadedFiles) {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }
      let userFriendlyMessage = e.message || "未知错误";
      if (
        userFriendlyMessage.includes("schema cache") ||
        userFriendlyMessage.includes("column") ||
        userFriendlyMessage.includes("does not exist") ||
        userFriendlyMessage.includes("not found")
      ) {
        userFriendlyMessage = "数据库结构不匹配或缺少必要字段，请联系管理员运行迁移。";
      }
      res.status(500).json({ error: "文件记录创建失败: " + userFriendlyMessage });
    }
  });
});

router.get("/:id/conversations/:conversationId/files", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const { id, conversationId } = req.params;
  const user = req.user!;

  try {
    const instance: any = await dbAdapter.getInstanceById(id);
    if (!instance) return res.status(404).json({ error: "实例不存在" });
    const isPrivileged = user.role === "admin" || user.role === "super_admin";
    if (instance.user_id !== user.id && !isPrivileged) {
      return res.status(403).json({ error: "无权限访问此实例" });
    }

    const ownerToUse = isPrivileged ? instance.user_id : user.id;
    const conv = await chatRepo.getConversationForOwnerAndInstance(ownerToUse, id, conversationId);
    if (!conv) {
      return res.status(404).json({ error: "会话不存在或不属于当前实例" });
    }

    const data = await filesRepo.listByConversation(id, conversationId);

    const mapped = (data || []).map(f => ({
      id: f.id,
      originalName: normalizeMultipartFilename(f.original_name || f.filename),
      filename: f.filename,
      mimeType: f.mime_type,
      size: f.size,
      createdAt: f.created_at,
      downloadUrl: getChatFileUrl(id, conversationId, f.id),
      previewUrl: getChatFileUrl(id, conversationId, f.id, "inline")
    }));

    res.json({ success: true, files: mapped });
  } catch (e: any) {
    console.error(JSON.stringify({
      operation: "chat_files_list_failed",
      instanceId: id,
      conversationId,
      error: e?.message || "Unknown Error"
    }));
    res.status(500).json({
      success: false,
      error: "CHAT_FILES_LIST_FAILED",
      message: "获取文件列表失败，请稍后重试。",
      files: []
    });
  }
});

router.use([
  "/:id/conversations/:conversationId/files/:fileId/html-preview",
  "/:id/conversations/:conversationId/files/:fileId/office-preview",
  "/:id/conversations/:conversationId/files/:fileId/download",
  "/:id/conversations/:conversationId/files/:fileId/media-preview",
], chatFileReadLimiter);

// These four handlers are protected by the path-scoped chatFileReadLimiter above.
// lgtm[js/missing-rate-limiting]
router.get("/:id/conversations/:conversationId/files/:fileId/html-preview", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const resolved = await resolveChatFileForAccess(req, res);
    if (!resolved) return;

    const displayName = normalizeMultipartFilename(resolved.file.original_name || resolved.file.filename || path.basename(resolved.storagePath));
    const mimeType = resolved.file.mime_type || "";
    if (!isHtmlArtifactPreview(displayName, mimeType)) {
      return res.status(415).json({ success: false, error: "CHAT_HTML_PREVIEW_TYPE_UNSUPPORTED", message: "该附件不是 HTML 文档。" });
    }
    const exportGuard = await guardFileExport(resolved.storagePath, displayName);
    if (exportGuard.ok === false) {
      return res.status(exportGuard.status).json({ success: false, error: exportGuard.code, message: exportGuard.error });
    }
    const stats = fs.statSync(exportGuard.realPath);
    if (stats.size > HTML_ARTIFACT_PREVIEW_MAX_BYTES) {
      return res.status(413).json({ success: false, error: "CHAT_HTML_PREVIEW_TOO_LARGE", message: "HTML 附件过大，请下载查看。", size: stats.size });
    }

    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", HTML_SINGLE_FILE_PREVIEW_CSP);
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(displayName)}`);
    return res.sendFile(exportGuard.realPath, (error) => {
      if (!error) return;
      console.error("[Chat File Preview] HTML stream failed", { filePath: exportGuard.realPath, error });
      if (!res.headersSent) res.status(Number((error as any).statusCode) || 500).json({ success: false, error: "CHAT_HTML_PREVIEW_TRANSFER_FAILED", message: "HTML 附件预览传输失败。" });
      else res.destroy(error);
    });
  } catch (e: any) {
    console.error(JSON.stringify({
      operation: "chat_html_preview_failed",
      instanceId: req.params.id,
      conversationId: req.params.conversationId,
      fileId: req.params.fileId,
      error: e?.message || "Unknown Error"
    }));
    return res.status(500).json({ success: false, error: "CHAT_HTML_PREVIEW_FAILED", message: "HTML 附件预览失败，请稍后重试。" });
  }
});

// lgtm[js/missing-rate-limiting]
router.get("/:id/conversations/:conversationId/files/:fileId/office-preview", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const resolved = await resolveChatFileForAccess(req, res);
    if (!resolved) return;
    const displayName = normalizeMultipartFilename(resolved.file.original_name || resolved.file.filename || path.basename(resolved.storagePath));
    const exportGuard = await guardFileExport(resolved.storagePath, displayName);
    if (exportGuard.ok === false) {
      return res.status(exportGuard.status).json({ success: false, error: exportGuard.code, message: exportGuard.error });
    }
    const preview = await renderLocalOfficePreview(exportGuard.realPath, displayName);
    return res.json({ success: true, ...preview });
  } catch (e: any) {
    const status = Number(e?.status) || 500;
    const code = String(e?.code || "CHAT_OFFICE_PREVIEW_FAILED");
    return res.status(status).json({ success: false, error: code, code, message: code === "OFFICE_PREVIEW_TOO_LARGE" ? "Office 文件过大，请下载查看。" : "Office 文件预览失败，请下载后查看。" });
  }
});


// lgtm[js/missing-rate-limiting]
router.get("/:id/conversations/:conversationId/files/:fileId/download", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const resolved = await resolveChatFileForAccess(req, res);
    if (!resolved) return;

    const displayName = normalizeMultipartFilename(resolved.file.original_name || resolved.file.filename || path.basename(resolved.storagePath));
    const exportGuard = await guardFileExport(resolved.storagePath, displayName);
    if (exportGuard.ok === false) {
      return res.status(exportGuard.status).json({ success: false, error: exportGuard.code, message: exportGuard.error });
    }
    const disposition = String(req.query.disposition || "attachment").toLowerCase() === "inline" ? "inline" : "attachment";
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Content-Type", resolved.file.mime_type || "application/octet-stream");
    res.setHeader("Content-Disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(displayName)}`);
    return res.sendFile(exportGuard.realPath);
  } catch (e: any) {
    console.error(JSON.stringify({
      operation: "chat_file_download_failed",
      instanceId: req.params.id,
      conversationId: req.params.conversationId,
      fileId: req.params.fileId,
      error: e?.message || "Unknown Error"
    }));
    return res.status(500).json({ success: false, error: "CHAT_FILE_DOWNLOAD_FAILED", message: "文件下载失败，请稍后重试。" });
  }
});

// lgtm[js/missing-rate-limiting]
router.get("/:id/conversations/:conversationId/files/:fileId/media-preview", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const resolved = await resolveChatFileForAccess(req, res);
    if (!resolved) return;
    const displayName = normalizeMultipartFilename(resolved.file.original_name || resolved.file.filename || path.basename(resolved.storagePath));
    const exportGuard = await guardFileExport(resolved.storagePath, displayName);
    if (exportGuard.ok === false) {
      return res.status(exportGuard.status).json({ success: false, error: exportGuard.code, message: exportGuard.error });
    }
    return streamLocalVideo(req, res, exportGuard.realPath, displayName);
  } catch (e: any) {
    console.error(JSON.stringify({ operation: "chat_media_preview_failed", instanceId: req.params.id, conversationId: req.params.conversationId, fileId: req.params.fileId, error: e?.message || "Unknown Error" }));
    return res.status(500).json({ success: false, error: "CHAT_MEDIA_PREVIEW_FAILED", code: "CHAT_MEDIA_PREVIEW_FAILED", message: "视频预览失败，请稍后重试。" });
  }
});
router.delete("/:id/conversations/:conversationId/files/:fileId", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const { id, conversationId, fileId } = req.params;
  try {
    const resolved = await resolveChatFileForAccess(req, res);
    if (!resolved) return;
    const activeRun = await chatRepo.getActiveRunForConversation(resolved.file.owner_id, id, conversationId);
    if (activeRun) {
      return res.status(409).json({ code: "ATTACHMENT_IN_USE", error: "ATTACHMENT_IN_USE", message: "当前会话任务仍在运行，暂不能删除附件。" });
    }
    await deleteChatAttachmentFile({ instanceId: id, conversationId, storagePath: resolved.storagePath });
    await filesRepo.delete(fileId);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: "删除文件失败: " + e.message });
  }
});

export function createChatFilesRoutes() {
  return router;
}


