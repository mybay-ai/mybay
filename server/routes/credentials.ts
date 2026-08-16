import { Router } from "express";
import { dbAdapter } from "../db";
import { encrypt } from "../crypto";
import { isMaskedSecretPlaceholder, sanitizeCredentialsForClient } from "../utils/sanitizer";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { getClientIp } from "../utils/ip";
import { authenticateToken } from "../middlewares/auth";
import { createApiErrorPayload, sendApiError } from "../utils/apiErrorResponse";
import { ErrorCodes } from "../../shared/errorCodes";

const router = Router();

const credentialsWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req: any) => `cred_write:ip:${getClientIp(req)}:user:${req.user?.id || "anon"}`,
  message: createApiErrorPayload({
    code: ErrorCodes.CREDENTIAL_RATE_LIMITED,
    legacyError: "操作过于频繁，请稍候再试。",
    message: "Credential operations are rate limited",
  }),
});

router.get("/", authenticateToken, async (req: any, res) => {
  try {
    const credentials = await dbAdapter.getCredentials(req.user.id);
    res.json(sanitizeCredentialsForClient(credentials));
  } catch (err: any) {
    console.error("[Credentials API Error] Failed to list credentials:", err);
    return sendApiError(res, {
      status: 500,
      code: ErrorCodes.CREDENTIALS_LOAD_FAILED,
      legacyError: "获取凭证列表失败，服务器内部异常",
      message: "Failed to load credentials",
    });
  }
});

router.post("/", authenticateToken, credentialsWriteLimiter, async (req: any, res) => {
  try {
    const { name, type, key, baseUrl, isCustom } = req.body;
    if (!name || !type || !key) {
      return sendApiError(res, {
        status: 400,
        code: ErrorCodes.CREDENTIAL_FIELDS_REQUIRED,
        legacyError: "Name, type and key are required",
        message: "Credential name, type and key are required",
      });
    }

    if (isMaskedSecretPlaceholder(key)) {
      return sendApiError(res, {
        status: 400,
        code: ErrorCodes.CREDENTIAL_SECRET_INVALID,
        legacyError: "凭证内容无效：检测到脱敏占位符，请输入真实 API Key",
        message: "The credential secret is a masked placeholder",
      });
    }

    if (baseUrl) {
      const { checkSSRFSafe } = require("../utils/ssrfValidator");
      const ssrfResult = await checkSSRFSafe(baseUrl);
      if (!ssrfResult.safe) {
        console.warn("[Credentials API] Rejected unsafe base URL:", ssrfResult.error);
        return sendApiError(res, {
          status: 400,
          code: ErrorCodes.CREDENTIAL_BASE_URL_UNSAFE,
          legacyError: "Credential base URL did not pass security validation",
          message: "Credential base URL did not pass security validation",
        });
      }
    }

    const newCredential = {
      id: crypto.randomUUID(),
      name,
      type,
      key: encrypt(key),
      base_url: baseUrl,
      is_custom: isCustom,
      verification_status: "untested",
      verified_at: null,
      user_id: req.user.id,
      created_at: new Date().toISOString(),
    };

    await dbAdapter.createCredential(newCredential);
    return res.json({ success: true, id: newCredential.id });
  } catch (err: any) {
    console.error("[Credentials API Error] Failed to create credential:", err);
    return sendApiError(res, {
      status: 500,
      code: ErrorCodes.CREDENTIAL_CREATE_FAILED,
      legacyError: "创建凭证失败，服务器内部异常",
      message: "Failed to create credential",
    });
  }
});

router.patch("/:id", authenticateToken, credentialsWriteLimiter, async (req: any, res) => {
  try {
    const { id } = req.params;
    const { name, key, baseUrl } = req.body;
    const updates: any = {};

    if (name) updates.name = name;
    if (baseUrl !== undefined) {
      if (baseUrl) {
        const { checkSSRFSafe } = require("../utils/ssrfValidator");
        const ssrfResult = await checkSSRFSafe(baseUrl);
        if (!ssrfResult.safe) {
          console.warn("[Credentials API] Rejected unsafe base URL update:", ssrfResult.error);
          return sendApiError(res, {
            status: 400,
            code: ErrorCodes.CREDENTIAL_BASE_URL_UNSAFE,
            legacyError: "Credential base URL did not pass security validation",
            message: "Credential base URL did not pass security validation",
          });
        }
      }
      updates.base_url = baseUrl;
    }
    if (key && !isMaskedSecretPlaceholder(key)) updates.key = encrypt(key);
    if (baseUrl !== undefined || (key && !isMaskedSecretPlaceholder(key))) {
      updates.verification_status = "untested";
      updates.verified_at = null;
    }

    await dbAdapter.updateCredential(id, req.user.id, updates);
    return res.json({ success: true });
  } catch (err: any) {
    console.error("[Credentials API Error] Failed to update credential:", err);
    return sendApiError(res, {
      status: 500,
      code: ErrorCodes.CREDENTIAL_UPDATE_FAILED,
      legacyError: "更新凭证失败，服务器内部异常",
      message: "Failed to update credential",
    });
  }
});

router.delete("/:id", authenticateToken, credentialsWriteLimiter, async (req: any, res) => {
  try {
    const instances = await dbAdapter.getInstances(req.user.id, req.user.role);
    const referencingInstances = instances.filter((instance: any) => {
      try {
        return JSON.parse(instance.config_json || "{}").providerCredentialId === req.params.id;
      } catch {
        return false;
      }
    });
    if (referencingInstances.length > 0) {
      return sendApiError(res, {
        status: 409,
        code: ErrorCodes.CREDENTIAL_IN_USE,
        legacyError: "该模型凭据仍被实例引用，请先为相关实例更换凭据后再删除。",
        message: "The credential is still referenced by an instance",
        extra: { details: {
          instances: referencingInstances.map((instance: any) => ({ id: instance.id, name: instance.name })),
        } },
      });
    }
    await dbAdapter.deleteCredential(req.params.id, req.user.id);
    return res.json({ success: true });
  } catch (err: any) {
    console.error("[Credentials API Error] Failed to delete credential:", err);
    return sendApiError(res, {
      status: 500,
      code: ErrorCodes.CREDENTIAL_DELETE_FAILED,
      legacyError: "删除凭证失败，服务器内部异常",
      message: "Failed to delete credential",
    });
  }
});

export default router;
