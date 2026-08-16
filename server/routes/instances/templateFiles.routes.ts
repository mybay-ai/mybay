
import { Router, Response } from "express";
import { AuthenticatedRequest, authenticateToken } from "../../middlewares/auth";
import multer from "multer";
import path from "path";
import fs from "fs";
import { filesRepo } from "../../repositories/filesRepo";
import { randomUUID } from "node:crypto";
import { validateUploadedFilePath } from "../../utils/uploadSecurity";

const router = Router();

const tempStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), "data", "temp_uploads");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const cleanName = `${randomUUID()}${ext}`;
    cb(null, cleanName);
  }
});

const tempUpload = multer({
  storage: tempStorage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = [".pdf", ".docx", ".txt", ".json", ".csv"];
    if (!allowed.includes(ext)) {
      return cb(new Error("不支持的文件类型。仅允许 PDF, DOCX, TXT, JSON, CSV。") as any, false);
    }
    cb(null, true);
  }
}).single("file");

router.post("/upload", authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  tempUpload(req, res, async (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "文件容量超出极限，上限为 20MB。" });
      }
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: "没有上传文件" });
    }

const validation = validateUploadedFilePath({
      filePath: req.file.path,
      originalName: req.file.originalname,
      declaredMime: req.file.mimetype,
      allowedExtensions: new Set([".pdf", ".docx", ".txt", ".json", ".csv"]),
    });
    if (validation.ok === false) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: validation.error, code: "INVALID_UPLOAD_CONTENT" });
    }
    req.file.mimetype = validation.mime;

    try {
      const fileRecord = await filesRepo.create({
        owner_id: req.user!.id,
        filename: req.file.originalname,
        mime_type: req.file.mimetype,
        size: req.file.size,
        storage_path: req.file.path,
        instance_id: null
      });

      res.status(201).json({
        fileId: fileRecord.id,
        filename: fileRecord.filename,
        mimeType: fileRecord.mime_type,
        size: fileRecord.size
      });
    } catch (e: any) {
      // Cleanup file if DB insert fails
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({ error: "文件记录创建失败: " + e.message });
    }
  });
});

router.delete("/:fileId", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { fileId } = req.params;
    if (!fileId) {
      return res.status(400).json({ error: "缺少文件 ID" });
    }

    const fileRecord = await filesRepo.findById(fileId);
    if (!fileRecord) {
      return res.status(404).json({ error: "找不到该文件记录" });
    }

    // Check ownership
    if (fileRecord.owner_id !== req.user!.id) {
      return res.status(403).json({ error: "无权访问此文件" });
    }

    // Check if unbound
    if (fileRecord.instance_id !== null) {
      return res.status(400).json({ error: "此文件已绑定到实例，不允许在此删除。" });
    }

    // Attempt physical deletion with consistent rollback constraint
    if (fileRecord.storage_path) {
      const tempRoot = path.resolve(process.cwd(), "data", "temp_uploads");
      const targetPath = path.resolve(String(fileRecord.storage_path));
      if (!targetPath.startsWith(tempRoot + path.sep) || (fs.existsSync(targetPath) && fs.lstatSync(targetPath).isSymbolicLink())) {
        return res.status(403).json({ error: "Unsafe template file path.", code: "INVALID_FILE_PATH" });
      }
      if (fs.existsSync(fileRecord.storage_path)) {
        try {
          fs.unlinkSync(fileRecord.storage_path);
        } catch (unlinkErr: any) {
          console.error(`[Template File Cleanup Error] Failed to delete file on disk at ${fileRecord.storage_path}:`, unlinkErr);
          return res.status(500).json({ error: "物理文件删除失败，无法同步清除数据库记录。" });
        }
      } else {
        console.warn(`[Template File Cleanup Warning] Physical file not found at ${fileRecord.storage_path}, proceeding with DB orphaned record cleanup.`);
      }
    }

    // Delete db record
    await filesRepo.delete(fileId);

    res.json({ success: true, message: "文件记录与物理文件已安全清理" });
  } catch (e: any) {
    res.status(500).json({ error: "删除文件记录失败: " + e.message });
  }
});

export default router;
