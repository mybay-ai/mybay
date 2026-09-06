import express, { Router, type RequestHandler, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import AdmZip from "adm-zip";
import { INSTANCE_UPLOAD_MAX_BYTES, INSTANCE_UPLOAD_TEXT_EXTENSIONS, isInstanceUploadDirectory, isInstanceUploadFilename } from "../../../shared/instanceFileUpload";
import { validateUploadedFileBuffer } from "../../utils/uploadSecurity";
import type { StorageQuotaStats } from "../../services/instances/instanceStorageQuotaService";
import { commitInstanceFileUploadReceipt, getInstanceFileUploadReceipt } from "../../services/instances/instanceFileUploadReceipts";

type Validation = { error: string; status: number } | { rootDir: string; absolutePath: string; candidatePath?: string; instance: unknown };
type Dependencies = {
  authenticate: RequestHandler;
  validateAccess: (req: any, instanceId: string, requestedPath: string) => Promise<Validation>;
  checkQuota: (instance: any, rootDir: string) => Promise<StorageQuotaStats>;
  isSensitive: (name: string) => boolean;
};

function reject(status: number, code: string): never { throw Object.assign(new Error(code), { status, code }); }
const validUploadId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

function getSingleSearchParameter(req: Request, key: string): string {
  const values = new URL(req.originalUrl, "http://localhost").searchParams.getAll(key);
  return values.length === 1 ? values[0] : "";
}

function validateContent(buffer: Buffer, name: string) {
  const extension = path.extname(name).toLowerCase();
  if (INSTANCE_UPLOAD_TEXT_EXTENSIONS.includes(extension)) {
    try {
      if (buffer.includes(0)) reject(400, "UPLOAD_CONTENT_INVALID");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      if (extension === ".json") JSON.parse(text);
    } catch { reject(400, "UPLOAD_CONTENT_INVALID"); }
    return;
  }
  if (extension === ".pptx") {
    try {
      const names = new AdmZip(buffer).getEntries().map(entry => entry.entryName);
      if (!names.includes("[Content_Types].xml") || !names.some(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))) reject(400, "UPLOAD_CONTENT_INVALID");
    } catch { reject(400, "UPLOAD_CONTENT_INVALID"); }
    return;
  }
  const imageMime: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
  if (!validateUploadedFileBuffer({ buffer, originalName: name, declaredMime: imageMime[extension] || "application/octet-stream", allowedExtensions: new Set([extension]) }).ok) reject(400, "UPLOAD_CONTENT_INVALID");
}

// No symlink segment may redirect a write, even to another directory in the instance.
function assertDirectory(root: string, directory: string): string {
  let current = root;
  for (const segment of directory.slice(1).split("/")) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) reject(403, "UPLOAD_DIRECTORY_INVALID");
  }
  if (!fs.realpathSync(current).startsWith(root + path.sep)) reject(403, "UPLOAD_DIRECTORY_INVALID");
  return current;
}

export function createInstanceFileUploadRoutes(deps: Dependencies) {
  const router = Router();
  const active = new Set<string>();
  const parse = express.raw({ type: "application/octet-stream", limit: INSTANCE_UPLOAD_MAX_BYTES });
  router.post("/:id/files/upload", deps.authenticate, async (req: Request, res: Response) => {
    const id = req.params.id;
    const directory = getSingleSearchParameter(req, "path");
    const name = getSingleSearchParameter(req, "name");
    const uploadId = req.get("X-Upload-Id");
    const fail = (error: any) => {
      if (res.headersSent || res.destroyed) return;
      const status = error.type === "entity.too.large" ? 413 : error.code === "EEXIST" ? 409 : error.status || 500;
      const code = error.type === "entity.too.large" ? "UPLOAD_TOO_LARGE" : error.code === "EEXIST" ? "UPLOAD_EXISTS" : String(error.code || "UPLOAD_FAILED");
      res.status(status).json({ error: code, code });
    };
    let locked = false;
    try {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !isInstanceUploadDirectory(directory) || directory.split("/").some(deps.isSensitive)) reject(403, "UPLOAD_DIRECTORY_INVALID");
      if (!isInstanceUploadFilename(name) || deps.isSensitive(name)) reject(400, "UPLOAD_NAME_INVALID");
      const safeName = path.basename(name);
      if (safeName !== name) reject(400, "UPLOAD_NAME_INVALID");
      const artifactPath = path.posix.join(directory, safeName);
      if (uploadId && !validUploadId(uploadId)) reject(400, "INVALID_UPLOAD_ID");
      if (!req.is("application/octet-stream")) reject(415, "UPLOAD_CONTENT_TYPE");
      if (Number(req.headers["content-length"]) > INSTANCE_UPLOAD_MAX_BYTES) reject(413, "UPLOAD_TOO_LARGE");
      const validation = await deps.validateAccess(req, id, "/");
      if ("error" in validation) reject(validation.status, "UPLOAD_ACCESS_DENIED");
      const root = fs.realpathSync(validation.rootDir);
      if (uploadId) {
        const receipt = getInstanceFileUploadReceipt(id, uploadId);
        if (receipt) {
          const expectedPath = artifactPath;
          if (receipt.directory !== directory || receipt.name !== name || receipt.path !== expectedPath) reject(409, "UPLOAD_REQUEST_CONFLICT");
          const target = path.resolve(root, receipt.path.slice(1));
          if (!target.startsWith(root + path.sep)) reject(409, "UPLOAD_RECEIPT_STALE");
          try {
            const stat = fs.lstatSync(target);
            if (stat.isSymbolicLink() || !stat.isFile() || stat.size !== receipt.size || sha256(fs.readFileSync(target)) !== receipt.sha256) reject(409, "UPLOAD_RECEIPT_STALE");
            const real = fs.realpathSync(target);
            if (!real.startsWith(root + path.sep)) reject(409, "UPLOAD_RECEIPT_STALE");
          } catch (error: any) {
            if (error?.code === "UPLOAD_RECEIPT_STALE") throw error;
            reject(409, "UPLOAD_RECEIPT_STALE");
          }
          return res.status(200).json({ ok: true, reused: true, uploadId, name, size: receipt.size, path: receipt.path });
        }
      }
      if (active.has(id) || active.size >= 4) reject(409, "UPLOAD_BUSY");
      active.add(id); locked = true;
      // Only the five first-level artifact directories may be created automatically.
      const segments = directory.slice(1).split("/");
      const first = path.join(root, segments[0]);
      if (!fs.existsSync(first)) fs.mkdirSync(first, { mode: 0o755 });
      const targetDirectory = assertDirectory(root, directory);
      const initialIdentity = fs.statSync(targetDirectory);
      const initialTarget = path.resolve(targetDirectory, safeName);
      if (path.dirname(initialTarget) !== targetDirectory) reject(400, "UPLOAD_NAME_INVALID");
      if (fs.existsSync(initialTarget)) reject(409, "UPLOAD_EXISTS");
      const before = await deps.checkQuota(validation.instance, root);
      if (before.storageUsedBytes === null || before.storageStatus === "unknown") reject(503, "UPLOAD_QUOTA_UNKNOWN");
      if (before.storageExceeded || before.storageStatus === "exceeded") reject(413, "UPLOAD_QUOTA_EXCEEDED");
      await new Promise<void>((resolve, rejectParse) => parse(req, res, error => error ? rejectParse(error) : resolve()));
      if (req.aborted || res.destroyed) return;
      if (!Buffer.isBuffer(req.body)) reject(400, "UPLOAD_CONTENT_INVALID");
      const bytes: Buffer = req.body;
      validateContent(bytes, name);
      const contentSha256 = sha256(bytes);
      const currentQuota = await deps.checkQuota(validation.instance, root);
      if (currentQuota.storageUsedBytes === null || currentQuota.storageStatus === "unknown") reject(503, "UPLOAD_QUOTA_UNKNOWN");
      if (currentQuota.storageExceeded || (currentQuota.storageLimitBytes !== null && currentQuota.storageUsedBytes + bytes.length > currentQuota.storageLimitBytes)) reject(413, "UPLOAD_QUOTA_EXCEEDED");
      if (req.aborted || res.destroyed) return;
      const checkedDirectory = assertDirectory(root, directory);
      const currentIdentity = fs.statSync(checkedDirectory);
      if (currentIdentity.ino !== initialIdentity.ino || currentIdentity.dev !== initialIdentity.dev) reject(409, "UPLOAD_DIRECTORY_CHANGED");
      const temporary = path.join(checkedDirectory, `.mybay-upload-${randomUUID()}.part`);
      const target = path.resolve(checkedDirectory, safeName);
      if (path.dirname(target) !== checkedDirectory) reject(400, "UPLOAD_NAME_INVALID");
      let ownedTemporary = false;
      let published = false;
      try {
        const descriptor = fs.openSync(temporary, "wx", 0o644);
        ownedTemporary = true;
        try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
        assertDirectory(root, directory);
        // Hard-link publication is atomic and never replaces an existing name.
        fs.linkSync(temporary, target);
        published = true;
        if (uploadId) commitInstanceFileUploadReceipt({ uploadId, instanceId: id, directory, name: safeName, path: artifactPath, size: bytes.length, sha256: contentSha256 });
      } catch (error) {
        // A receipt and its published file are one logical commit. If durable
        // receipt persistence fails, remove only the hard link made here so a
        // retry cannot be mistaken for an unrelated same-name file.
        if (published) { try { fs.unlinkSync(target); } catch { /* A later retry will report the exact conflict. */ } }
        throw error;
      } finally {
        if (ownedTemporary) { try { fs.unlinkSync(temporary); } catch { /* Only remove this request's staging file. */ } }
      }
      res.status(201).json({ ok: true, reused: false, ...(uploadId ? { uploadId } : {}), name: safeName, size: bytes.length, path: artifactPath });
    } catch (error) { fail(error); }
    finally { if (locked) active.delete(id); }
  });
  return router;
}
