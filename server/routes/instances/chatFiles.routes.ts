import { Router, Response } from "express";
import { AuthenticatedRequest, authenticateToken } from "../../middlewares/auth";
import multer from "multer";
import path from "path";
import fs from "fs";
import { chatRepo } from "../../repositories/chatRepo";
import { filesRepo } from "../../repositories/filesRepo";
import { guardFileExport } from "../../services/instances/instanceFileLeakGuard";
import { randomUUID } from "node:crypto";
import { resolveContentValidatedExtensions, validateUploadedFilePath } from "../../utils/uploadSecurity";
import { getChatAttachmentConfig } from "../../config/chatAttachmentConfig";
import { DEFAULT_CHAT_ATTACHMENT_CONFIG } from "../../../shared/chatAttachmentContract";
import { deleteChatAttachmentFile, inspectChatAttachmentFile, inspectConversationAttachmentDirectory, purgeDeletedChatAttachments } from "../../services/chatAttachmentStorage";
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
import {
  resolveConversationAuthority,
  resolveConversationFileAuthority,
  resolveInstanceAuthority,
} from "../../services/instances/resourceAuthorityService";
import { authorityActorFromRequest, sendAuthorityFailure } from "../../services/instances/resourceAuthorityHttp";

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
    try {
      cb(null, inspectConversationAttachmentDirectory(id, conversationId, undefined, true));
    } catch {
      cb(new Error("附件目录未通过安全校验，请检查实例存储。"), "");
    }
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

function uploadedFileResponse(file: import("../../repositories/filesRepo").FileRecord) {
  return {
    id: file.id, originalName: normalizeMultipartFilename(file.original_name || file.filename),
    mimeType: file.mime_type, size: file.size, createdAt: file.created_at,
    downloadUrl: getChatFileUrl(file.instance_id!, file.conversation_id!, file.id),
    previewUrl: getChatFileUrl(file.instance_id!, file.conversation_id!, file.id, "inline"),
  };
}

async function requireReusableUpload(file: import("../../repositories/filesRepo").FileRecord) {
  if (file.deleted_at) throw new Error("ATTACHMENT_UNAVAILABLE");
  const inspected = await inspectChatAttachmentFile({ instanceId: file.instance_id!, conversationId: file.conversation_id!, storagePath: file.storage_path });
  if (!inspected.exists || inspected.stat.size !== file.size || path.basename(file.storage_path) !== file.filename) throw new Error("ATTACHMENT_UNAVAILABLE");
}

async function resolveChatFileForAccess(req: AuthenticatedRequest, res: Response) {
  const { id, conversationId, fileId } = req.params;
  const instanceAuthority = await resolveInstanceAuthority({ actor: authorityActorFromRequest(req), instanceId: id });
  if (instanceAuthority.ok === false) {
    sendAuthorityFailure(res, instanceAuthority, "无法访问目标实例。");
    return null;
  }
  const conversationAuthority = await resolveConversationAuthority({ instance: instanceAuthority, conversationId });
  if (conversationAuthority.ok === false) {
    sendAuthorityFailure(res, conversationAuthority, "会话不存在或无权访问。");
    return null;
  }
  const fileAuthority = await resolveConversationFileAuthority({
    conversation: conversationAuthority,
    fileId,
    includeDeleted: true,
  });
  if (fileAuthority.ok === false) {
    sendAuthorityFailure(res, fileAuthority, "文件不存在或无权访问。");
    return null;
  }
  const data = fileAuthority.file;
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
    const inspected = await inspectChatAttachmentFile({ instanceId: id, conversationId, storagePath });
    if (!inspected.exists) {
      res.status(404).json({ success: false, error: "FILE_MISSING", message: "文件记录存在，但物理文件不存在。" });
      return null;
    }
    if (path.basename(storagePath) !== data.filename || inspected.stat.size !== data.size) {
      res.status(403).json({ success: false, error: "INVALID_FILE_PATH", message: "文件路径未通过安全校验。" });
      return null;
    }
    return { file: data, storagePath: inspected.storagePath, rootDir: path.dirname(inspected.storagePath) };
  } catch {
    res.status(403).json({ success: false, code: "INVALID_FILE_PATH", error: "INVALID_FILE_PATH", message: "文件路径未通过安全校验。" });
    return null;
  }

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
  const uploadId = req.get("X-Upload-Id");
  if (uploadId && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId)) {
    return res.status(400).json({ code: "INVALID_UPLOAD_ID", error: "INVALID_UPLOAD_ID" });
  }

  try {
    const instanceAuthority = await resolveInstanceAuthority({ actor: authorityActorFromRequest(req), instanceId: id });
    if (instanceAuthority.ok === false) return sendAuthorityFailure(res, instanceAuthority, "无法访问目标实例。");
    const conversationAuthority = await resolveConversationAuthority({ instance: instanceAuthority, conversationId });
    if (conversationAuthority.ok === false) return sendAuthorityFailure(res, conversationAuthority, "会话不存在或无权访问。");
    // First committed file wins for this owner/instance/conversation/key.
    // Check before quota: a lost response must remain recoverable at full capacity.
    if (uploadId) {
      const previous = await filesRepo.findUpload(user.id, id, conversationId, uploadId);
      if (previous) {
        try { await requireReusableUpload(previous); }
        catch { return res.status(409).json({ code: "ATTACHMENT_UNAVAILABLE", error: "ATTACHMENT_UNAVAILABLE" }); }
        return res.status(200).json({ success: true, files: [uploadedFileResponse(previous)] });
      }
    }
    instance = instanceAuthority.instance;
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
    if (uploadId && uploadedFiles.length !== 1) {
      for (const file of uploadedFiles) if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(400).json({ code: "UPLOAD_REQUIRES_SINGLE_FILE", error: "UPLOAD_REQUIRES_SINGLE_FILE" });
    }
    const configuredExtensions = chatAttachmentConfig.allowedExtensions;
    const validatedExtensions = resolveContentValidatedExtensions(configuredExtensions, contentValidatedExtensions);
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
        allowedExtensions: validatedExtensions,
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

        const committed = uploadId
          ? await filesRepo.createUploadOnce({ ...insertData, upload_request_id: uploadId })
          : { file: await filesRepo.create(insertData), created: true };
        const data = committed.file;
        if (committed.created) createdRecordIds.push(data.id);
        else {
          await fs.promises.unlink(file.path);
          await requireReusableUpload(data);
        }

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

  try {
    const instanceAuthority = await resolveInstanceAuthority({ actor: authorityActorFromRequest(req), instanceId: id });
    if (instanceAuthority.ok === false) return sendAuthorityFailure(res, instanceAuthority, "无法访问目标实例。");
    const conversationAuthority = await resolveConversationAuthority({ instance: instanceAuthority, conversationId });
    if (conversationAuthority.ok === false) return sendAuthorityFailure(res, conversationAuthority, "会话不存在或无权访问。");

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
    const exportGuard = await guardFileExport(resolved.storagePath, displayName, resolved.rootDir);
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
    const exportGuard = await guardFileExport(resolved.storagePath, displayName, resolved.rootDir);
    if (exportGuard.ok === false) {
      return res.status(exportGuard.status).json({ success: false, error: exportGuard.code, message: exportGuard.error });
    }
    const preview = await renderLocalOfficePreview(exportGuard.realPath, displayName, exportGuard.rootPath);
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
    const exportGuard = await guardFileExport(resolved.storagePath, displayName, resolved.rootDir);
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
    const exportGuard = await guardFileExport(resolved.storagePath, displayName, resolved.rootDir);
    if (exportGuard.ok === false) {
      return res.status(exportGuard.status).json({ success: false, error: exportGuard.code, message: exportGuard.error });
    }
    return streamLocalVideo(req, res, exportGuard.realPath, displayName, exportGuard.rootPath);
  } catch (e: any) {
    console.error(JSON.stringify({ operation: "chat_media_preview_failed", instanceId: req.params.id, conversationId: req.params.conversationId, fileId: req.params.fileId, error: e?.message || "Unknown Error" }));
    return res.status(500).json({ success: false, error: "CHAT_MEDIA_PREVIEW_FAILED", code: "CHAT_MEDIA_PREVIEW_FAILED", message: "视频预览失败，请稍后重试。" });
  }
});
router.delete("/:id/conversations/:conversationId/files/:fileId", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const { id, conversationId, fileId } = req.params;
  try {
    const instanceAuthority = await resolveInstanceAuthority({ actor: authorityActorFromRequest(req), instanceId: id });
    if (instanceAuthority.ok === false) return sendAuthorityFailure(res, instanceAuthority, "无法访问目标实例。");
    const conversationAuthority = await resolveConversationAuthority({ instance: instanceAuthority, conversationId });
    if (conversationAuthority.ok === false) return sendAuthorityFailure(res, conversationAuthority, "会话不存在或无权访问。");
    const fileAuthority = await resolveConversationFileAuthority({ conversation: conversationAuthority, fileId, includeDeleted: true });
    if (fileAuthority.ok === false) return sendAuthorityFailure(res, fileAuthority, "文件不存在或无权访问。");
    if (fileAuthority.file.deleted_at) return res.status(410).json({ success: false, code: "FILE_DELETED", error: "FILE_DELETED", message: "文件已删除。" });
    const activeRun = await chatRepo.getActiveRunForConversation(fileAuthority.file.owner_id, id, conversationId);
    if (activeRun) {
      return res.status(409).json({ code: "ATTACHMENT_IN_USE", error: "ATTACHMENT_IN_USE", message: "当前会话任务仍在运行，暂不能删除附件。" });
    }
    const physicalFile = await inspectChatAttachmentFile({ instanceId: id, conversationId, storagePath: fileAuthority.file.storage_path });
    await filesRepo.softDelete(fileId);
    let cleanupPending = false;
    let physicalMissing = !physicalFile.exists;
    try {
      if (physicalFile.exists) {
        await deleteChatAttachmentFile({ instanceId: id, conversationId, storagePath: physicalFile.storagePath });
      }
      await filesRepo.markCleanupComplete(fileId);
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        physicalMissing = true;
        await filesRepo.markCleanupComplete(fileId);
      } else {
        cleanupPending = true;
        console.warn(JSON.stringify({ operation: "chat_file_physical_delete_deferred", fileId }));
        void purgeDeletedChatAttachments({ limit: 20 }).catch(() => {});
      }
    }
    res.json({ success: true, cleanupPending, physicalMissing });
  } catch (e: any) {
    res.status(500).json({ error: "删除文件失败: " + e.message });
  }
});

router.post("/:id/conversations/:conversationId/files/batch-resolve", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const { id, conversationId } = req.params;
  const fileIds = req.body?.fileIds;
  if (!Array.isArray(fileIds) || fileIds.length > 100 || fileIds.some((value) => typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim()))) {
    return res.status(400).json({ success: false, code: "INVALID_REQUEST", error: "INVALID_REQUEST", message: "fileIds 必须是最多 100 个有效 UUID。" });
  }
  try {
    const instanceAuthority = await resolveInstanceAuthority({ actor: authorityActorFromRequest(req), instanceId: id });
    if (instanceAuthority.ok === false) return sendAuthorityFailure(res, instanceAuthority, "无法访问目标实例。");
    const conversationAuthority = await resolveConversationAuthority({ instance: instanceAuthority, conversationId });
    if (conversationAuthority.ok === false) return sendAuthorityFailure(res, conversationAuthority, "会话不存在或无权访问。");
    const requestedIds = Array.from(new Set(fileIds.map((value: string) => value.trim()))) as string[];
    const files: Record<string, any> = {};
    await Promise.all(requestedIds.map(async (requestedId) => {
      const record = await filesRepo.findById(requestedId);
      const belongsToConversation = record
        && record.owner_id === conversationAuthority.ownerId
        && record.instance_id === id
        && record.conversation_id === conversationId;
      if (!belongsToConversation) {
        files[requestedId] = { availability: "unavailable", fileId: requestedId };
        return;
      }
      files[requestedId] = {
        availability: record.deleted_at ? "deleted" : "available",
        fileId: record.id,
        originalName: normalizeMultipartFilename(record.original_name || record.filename),
        mimeType: record.mime_type || "application/octet-stream",
        size: Number.isFinite(record.size) ? record.size : 0,
      };
    }));
    return res.json({ success: true, files });
  } catch (e: any) {
    console.error(JSON.stringify({ operation: "chat_files_batch_resolve_failed", instanceId: id, conversationId, error: e?.message || "Unknown Error" }));
    return res.status(500).json({ success: false, code: "BATCH_RESOLVE_FAILED", error: "BATCH_RESOLVE_FAILED", message: "批量解析文件状态失败。" });
  }
});

export function createChatFilesRoutes() {
  return router;
}


