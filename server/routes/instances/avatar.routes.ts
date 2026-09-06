import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { Router, type Response } from "express";
import multer from "multer";
import { dbAdapter } from "../../db";
import { authenticateToken, type AuthenticatedRequest } from "../../middlewares/auth";
import { detectSafeImageType, isDeclaredImageTypeCompatible } from "../../utils/imageUploadSecurity";
import { resolveInstanceDataDir } from "../../utils/instances/instancePathUtils";
import { parseInstanceConfigJson } from "../../services/instanceConfig/instanceConfigRoutePolicy";
import type { RouterDependencies } from "./index";

const AGENT_AVATAR_RELATIVE_DIR = path.join("uploads", "agent-avatar");
const AGENT_AVATAR_FILE_PATTERN = /^avatar\.(?:jpg|png|webp|gif)$/;

const uploadAgentAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024, files: 1 },
}).single("avatarFile");

function canManageInstance(req: AuthenticatedRequest, instance: any) {
  return instance.user_id === req.user.id || req.user.role === "admin" || req.user.role === "super_admin";
}

function resolveAvatarPath(instance: any, filename: string) {
  if (!AGENT_AVATAR_FILE_PATTERN.test(filename)) return null;
  const instanceRoot = path.resolve(resolveInstanceDataDir(instance));
  const avatarDir = path.resolve(instanceRoot, AGENT_AVATAR_RELATIVE_DIR);
  const avatarPath = path.resolve(avatarDir, filename);
  if (!avatarPath.startsWith(`${avatarDir}${path.sep}`)) return null;
  return { avatarDir, avatarPath };
}

function buildAvatarUrl(instanceId: string, updatedAt?: string) {
  const version = updatedAt ? `?v=${encodeURIComponent(updatedAt)}` : "";
  return `/api/instances/${encodeURIComponent(instanceId)}/avatar${version}`;
}

export function createAvatarRoutes(deps: RouterDependencies) {
  const router = Router();

  router.get("/:id/avatar", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const instance: any = await dbAdapter.getInstanceById(req.params.id);
    if (!instance) return res.status(404).json({ code: "INSTANCE_NOT_FOUND", error: "Instance not found" });
    if (!canManageInstance(req, instance)) return res.status(403).json({ code: "FORBIDDEN", error: "Forbidden" });

    const config = parseInstanceConfigJson(instance.config_json);
    const resolved = resolveAvatarPath(instance, String(config.agentAvatarFilename || ""));
    if (!resolved || !fs.existsSync(resolved.avatarPath)) return res.status(404).json({ code: "AGENT_AVATAR_NOT_FOUND", error: "Agent avatar not found" });

    res.setHeader("Cache-Control", "private, no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    return res.sendFile(resolved.avatarPath);
  });

  router.post("/:id/avatar", authenticateToken, (req: AuthenticatedRequest, res: Response) => {
    uploadAgentAvatar(req, res, async (uploadError) => {
      try {
        if (uploadError) {
          return res.status(400).json({
            code: uploadError.code === "LIMIT_FILE_SIZE" ? "AGENT_AVATAR_TOO_LARGE" : "AGENT_AVATAR_UPLOAD_INVALID",
            error: uploadError.code === "LIMIT_FILE_SIZE" ? "Image exceeds the 1 MB limit." : uploadError.message,
          });
        }
        if (!req.file?.buffer) return res.status(400).json({ code: "AGENT_AVATAR_FILE_REQUIRED", error: "No file uploaded." });

        const instance: any = await dbAdapter.getInstanceById(req.params.id);
        if (!instance) return res.status(404).json({ code: "INSTANCE_NOT_FOUND", error: "Instance not found" });
        if (!canManageInstance(req, instance)) return res.status(403).json({ code: "FORBIDDEN", error: "Forbidden" });

        const detected = detectSafeImageType(req.file.buffer);
        if (!detected || !isDeclaredImageTypeCompatible(req.file.mimetype, detected)) {
          return res.status(400).json({ code: "AGENT_AVATAR_CONTENT_INVALID", error: "File content does not match an allowed image format." });
        }

        const filename = `avatar${detected.extension}`;
        const resolved = resolveAvatarPath(instance, filename);
        if (!resolved) return res.status(400).json({ code: "AGENT_AVATAR_PATH_INVALID", error: "Invalid avatar path." });
        fs.mkdirSync(resolved.avatarDir, { recursive: true });

        const temporaryPath = path.join(resolved.avatarDir, `.${randomUUID()}.tmp`);
        fs.writeFileSync(temporaryPath, req.file.buffer, { flag: "wx" });
        for (const entry of fs.readdirSync(resolved.avatarDir)) {
          if (AGENT_AVATAR_FILE_PATTERN.test(entry)) fs.rmSync(path.join(resolved.avatarDir, entry), { force: true });
        }
        fs.renameSync(temporaryPath, resolved.avatarPath);

        const updatedAt = new Date().toISOString();
        const config = parseInstanceConfigJson(instance.config_json);
        config.agentAvatarFilename = filename;
        config.agentAvatarUpdatedAt = updatedAt;
        await dbAdapter.updateInstanceConfig(instance.id, JSON.stringify(config));
        await dbAdapter.insertAuditLog({
          instance_id: instance.id,
          action: "update_agent_avatar",
          user_id: req.user.id,
          timestamp: updatedAt,
          details: "Updated Agent avatar",
        });
        deps.io.emit("instances_updated", { id: instance.id, action: "avatar_update" });

        return res.json({ success: true, avatar_url: buildAvatarUrl(instance.id, updatedAt) });
      } catch (error: any) {
        console.error("Agent avatar upload failed:", error);
        return res.status(500).json({ code: "AGENT_AVATAR_UPLOAD_FAILED", error: "Failed to upload Agent avatar." });
      }
    });
  });

  router.delete("/:id/avatar", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) return res.status(404).json({ code: "INSTANCE_NOT_FOUND", error: "Instance not found" });
      if (!canManageInstance(req, instance)) return res.status(403).json({ code: "FORBIDDEN", error: "Forbidden" });

      const config = parseInstanceConfigJson(instance.config_json);
      const currentFilename = String(config.agentAvatarFilename || "");
      const resolved = resolveAvatarPath(instance, currentFilename);
      if (resolved) fs.rmSync(resolved.avatarDir, { recursive: true, force: true });
      delete config.agentAvatarFilename;
      delete config.agentAvatarUpdatedAt;
      await dbAdapter.updateInstanceConfig(instance.id, JSON.stringify(config));
      await dbAdapter.insertAuditLog({
        instance_id: instance.id,
        action: "reset_agent_avatar",
        user_id: req.user.id,
        timestamp: new Date().toISOString(),
        details: "Reset Agent avatar to the Runtime default",
      });
      deps.io.emit("instances_updated", { id: instance.id, action: "avatar_update" });
      return res.json({ success: true, avatar_url: null });
    } catch (error: any) {
      console.error("Agent avatar reset failed:", error);
      return res.status(500).json({ code: "AGENT_AVATAR_RESET_FAILED", error: "Failed to reset Agent avatar." });
    }
  });

  return router;
}
