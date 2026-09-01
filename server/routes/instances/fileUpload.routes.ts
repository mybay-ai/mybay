import express, { Router, type RequestHandler, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import AdmZip from "adm-zip";
import { INSTANCE_UPLOAD_MAX_BYTES, INSTANCE_UPLOAD_TEXT_EXTENSIONS, isInstanceUploadDirectory, isInstanceUploadFilename } from "../../../shared/instanceFileUpload";
import { validateUploadedFileBuffer } from "../../utils/uploadSecurity";
import type { StorageQuotaStats } from "../../services/instances/instanceStorageQuotaService";

type Validation = { error: string; status: number } | { rootDir: string; absolutePath: string; candidatePath?: string; instance: unknown };
type Dependencies = {
  authenticate: RequestHandler;
  validateAccess: (req: any, instanceId: string, requestedPath: string) => Promise<Validation>;
  checkQuota: (instance: any, rootDir: string) => Promise<StorageQuotaStats>;
  isSensitive: (name: string) => boolean;
};

function reject(status: number, code: string): never { throw Object.assign(new Error(code), { status, code }); }

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
    const directory = typeof req.query.path === "string" ? req.query.path : "";
    const name = typeof req.query.name === "string" ? req.query.name : "";
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
      if (!req.is("application/octet-stream")) reject(415, "UPLOAD_CONTENT_TYPE");
      if (Number(req.headers["content-length"]) > INSTANCE_UPLOAD_MAX_BYTES) reject(413, "UPLOAD_TOO_LARGE");
      const validation = await deps.validateAccess(req, id, "/");
      if ("error" in validation) reject(validation.status, "UPLOAD_ACCESS_DENIED");
      if (active.has(id) || active.size >= 4) reject(409, "UPLOAD_BUSY");
      active.add(id); locked = true;
      const root = fs.realpathSync(validation.rootDir);
      // Only the five first-level artifact directories may be created automatically.
      const segments = directory.slice(1).split("/");
      const first = path.join(root, segments[0]);
      if (!fs.existsSync(first)) fs.mkdirSync(first, { mode: 0o755 });
      const targetDirectory = assertDirectory(root, directory);
      const initialIdentity = fs.statSync(targetDirectory);
      if (fs.existsSync(path.join(targetDirectory, name))) reject(409, "UPLOAD_EXISTS");
      const before = await deps.checkQuota(validation.instance, root);
      if (before.storageUsedBytes === null || before.storageStatus === "unknown") reject(503, "UPLOAD_QUOTA_UNKNOWN");
      if (before.storageExceeded || before.storageStatus === "exceeded") reject(413, "UPLOAD_QUOTA_EXCEEDED");
      await new Promise<void>((resolve, rejectParse) => parse(req, res, error => error ? rejectParse(error) : resolve()));
      if (req.aborted || res.destroyed) return;
      if (!Buffer.isBuffer(req.body)) reject(400, "UPLOAD_CONTENT_INVALID");
      const bytes: Buffer = req.body;
      validateContent(bytes, name);
      const currentQuota = await deps.checkQuota(validation.instance, root);
      if (currentQuota.storageUsedBytes === null || currentQuota.storageStatus === "unknown") reject(503, "UPLOAD_QUOTA_UNKNOWN");
      if (currentQuota.storageExceeded || (currentQuota.storageLimitBytes !== null && currentQuota.storageUsedBytes + bytes.length > currentQuota.storageLimitBytes)) reject(413, "UPLOAD_QUOTA_EXCEEDED");
      if (req.aborted || res.destroyed) return;
      const checkedDirectory = assertDirectory(root, directory);
      const currentIdentity = fs.statSync(checkedDirectory);
      if (currentIdentity.ino !== initialIdentity.ino || currentIdentity.dev !== initialIdentity.dev) reject(409, "UPLOAD_DIRECTORY_CHANGED");
      const temporary = path.join(checkedDirectory, `.mybay-upload-${randomUUID()}.part`);
      const target = path.join(checkedDirectory, name);
      let ownedTemporary = false;
      try {
        const descriptor = fs.openSync(temporary, "wx", 0o644);
        ownedTemporary = true;
        try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
        assertDirectory(root, directory);
        // Hard-link publication is atomic and never replaces an existing name.
        fs.linkSync(temporary, target);
      } finally {
        if (ownedTemporary) { try { fs.unlinkSync(temporary); } catch { /* Only remove this request's staging file. */ } }
      }
      res.status(201).json({ ok: true, name, size: bytes.length, path: `${directory}/${name}` });
    } catch (error) { fail(error); }
    finally { if (locked) active.delete(id); }
  });
  return router;
}
