import { Router } from "express";
import { authenticateToken, type AuthenticatedRequest } from "../../middlewares/auth";
import { resolveInstanceAuthority } from "../../services/instances/resourceAuthorityService";
import { authorityActorFromRequest, sendAuthorityFailure } from "../../services/instances/resourceAuthorityHttp";
import { encrypt, isEncryptionKeyConfigured } from "../../crypto";
import { mutateStoreCollections } from "../../localStore";
import { managedFeishuStatus } from "../../services/channels/managedFeishuWorker";

const parseConfig = (row: any) => typeof row.config_json === "string" ? JSON.parse(row.config_json) : row.config_json || {};
function publicConfig(instance: any) {
  const config = parseConfig(instance);
  return { enabled: config.managedFeishuEnabled === true, appId: config.feishuAppId || "", hasSecret: Boolean(config.feishuAppSecret), allowedUsers: config.feishuAllowedUsers || "", allowedChats: config.feishuAllowedChats || "", status: managedFeishuStatus(instance.id) };
}

export function createManagedFeishuRoutes() {
  const router = Router();
  router.get("/:id/managed-feishu", authenticateToken, async (req: AuthenticatedRequest, res) => {
    const authority = await resolveInstanceAuthority({ actor: authorityActorFromRequest(req), instanceId: req.params.id });
    if (authority.ok === false) return sendAuthorityFailure(res, authority, "无法访问目标实例。");
    if (!["pi", "codex"].includes(authority.instance.runtime_type)) return res.status(422).json({ success: false, error: "CHANNEL_RUNTIME_UNSUPPORTED" });
    return res.json({ success: true, configuration: publicConfig(authority.instance) });
  });
  router.put("/:id/managed-feishu", authenticateToken, async (req: AuthenticatedRequest, res) => {
    const authority = await resolveInstanceAuthority({ actor: authorityActorFromRequest(req), instanceId: req.params.id });
    if (authority.ok === false) return sendAuthorityFailure(res, authority, "无法访问目标实例。");
    const body = req.body || {};
    if (typeof body.enabled !== "boolean" || (body.appId !== undefined && !/^cli_[A-Za-z0-9_-]{1,120}$/.test(body.appId))
      || (body.appSecret !== undefined && (typeof body.appSecret !== "string" || body.appSecret.length > 512))
      || [body.allowedUsers, body.allowedChats].some(value => value !== undefined && (typeof value !== "string" || value.length > 10000 || !/^[A-Za-z0-9_,;\s-]*$/.test(value)))) {
      return res.status(400).json({ success: false, error: "INVALID_CHANNEL_CONFIGURATION" });
    }
    if (body.appSecret && !isEncryptionKeyConfigured()) return res.status(503).json({ success: false, error: "ENCRYPTION_KEY_REQUIRED" });
    try {
      const updated = mutateStoreCollections(["instances"], data => {
        const instance = data.instances.find(row => row.id === authority.instance.id);
        if (!instance || (instance.user_id || instance.owner_id) !== authority.ownerId || (instance.user_id && instance.owner_id && instance.user_id !== instance.owner_id)) throw new Error("CHANNEL_INSTANCE_UNAVAILABLE");
        if (!["pi", "codex"].includes(instance.runtime_type)) throw new Error("CHANNEL_RUNTIME_UNSUPPORTED");
        const config = parseConfig(instance);
        if (body.appId !== undefined && body.appId !== config.feishuAppId && !body.appSecret) delete config.feishuAppSecret;
        Object.assign(config, { managedFeishuEnabled: body.enabled });
        if (body.appId !== undefined) config.feishuAppId = body.appId;
        if (body.appSecret) config.feishuAppSecret = encrypt(body.appSecret);
        if (body.allowedUsers !== undefined) config.feishuAllowedUsers = body.allowedUsers;
        if (body.allowedChats !== undefined) config.feishuAllowedChats = body.allowedChats;
        if (body.enabled && (!config.feishuAppId || !config.feishuAppSecret || !String(config.feishuAllowedUsers || "").trim())) throw new Error("CHANNEL_CONFIGURATION_REQUIRED");
        if (body.enabled && data.instances.some(other => {
          const otherConfig = parseConfig(other);
          const nativeFeishu = ["feishu", "lark"].includes(otherConfig.channel) && otherConfig.allowMode !== "disabled";
          return other.id !== instance.id && !other.archived_at && (otherConfig.managedFeishuEnabled === true || nativeFeishu) && otherConfig.feishuAppId === config.feishuAppId;
        })) throw new Error("FEISHU_APP_ALREADY_BOUND");
        instance.config_json = JSON.stringify(config);
        return instance;
      });
      return res.json({ success: true, configuration: publicConfig(updated) });
    } catch (error) {
      const code = error instanceof Error && /^(CHANNEL_|FEISHU_APP_ALREADY_BOUND)/.test(error.message) ? error.message : "CHANNEL_CONFIGURATION_FAILED";
      return res.status(409).json({ success: false, error: code });
    }
  });
  return router;
}
