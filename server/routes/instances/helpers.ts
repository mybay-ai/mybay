import path from "path";
import fs from "fs";
import os from "os";
import { dbAdapter } from "../../db";
import { docker } from "./index";
import { AuthenticatedRequest } from "../../middlewares/auth";
import multer from "multer";
import { buildDeploymentContext } from "../../deploymentContext";
import { parseTraefikEnv } from "../../infrastructure/traefik/traefikConfig";
import { randomUUID } from "node:crypto";

export const parseImageRef = (image: string) => {
  const defaultImage = process.env.MY_BAY_IMAGE || "nousresearch/hermes-agent";
  const defaultTag = process.env.MY_BAY_IMAGE_TAG || "latest";

  if (!image) {
    return { agent_image: defaultImage, agent_image_tag: defaultTag };
  }
  
  const lastColonIndex = image.lastIndexOf(':');
  if (lastColonIndex === -1 || lastColonIndex < image.lastIndexOf('/')) {
    return { agent_image: image, agent_image_tag: defaultTag };
  }
  
  const agent_image = image.substring(0, lastColonIndex);
  const agent_image_tag = image.substring(lastColonIndex + 1);
  return { agent_image, agent_image_tag };
};

export { isSensitiveFile, getMimeType, validateFileAccess } from "../../services/instances/instanceFileSecurityService";

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const instanceId = req.params.id;
    if (!instanceId || !/^[a-z0-9_-]+$/i.test(instanceId)) {
      return cb(new Error("非法实例 ID 标识符"), "");
    }
    const dir = path.join(process.cwd(), "data", "instances", instanceId, "uploads");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const cleanName = `${randomUUID()}${ext}`;
    cb(null, cleanName);
  }
});

export const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // Hard limits: 100MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== ".pdf") {
      return cb(new Error("安全机制拦截：格式不支持。系统目前仅支持上传真实的 .pdf 电子文档。") as any, false);
    }
    cb(null, true);
  }
}).single("file");

export async function checkAccessBridgeCompatibility(instance: any): Promise<any> {
  const tEnv = parseTraefikEnv(process.env);
  if (tEnv.proxyMode !== 'traefik') {
    return {
      required: false,
      compatible: true
    };
  }

  // If archived, deleting, deleted, or unknown statuses
  const ineligibleStatuses = new Set(["archived", "deleting", "deleted"]);
  if (instance.archived || ineligibleStatuses.has(String(instance.status).toLowerCase())) {
    return {
      required: true,
      compatible: true,
      reason: "unknown"
    };
  }

  try {
    const ctx = buildDeploymentContext(instance);
    const container = docker.getContainer(ctx.dashboardContainerName);
    const inspectState: any = await container.inspect().catch(() => null);
    
    if (!inspectState) {
      return {
        required: true,
        compatible: true,
        reason: "unknown"
      };
    }

    const labels = inspectState.Config?.Labels || {};
    const routerPrefix = `traefik.http.routers.hermes-${instance.id}-mybay`;
    
    const rule = labels[`${routerPrefix}.rule`];
    const priority = labels[`${routerPrefix}.priority`];
    const service = labels[`${routerPrefix}.service`];
    
    const secureRule = labels[`${routerPrefix}-secure.rule`];
    const securePriority = labels[`${routerPrefix}-secure.priority`];
    const secureService = labels[`${routerPrefix}-secure.service`];

    // Check if non-secure router matches
    if (!rule || !rule.includes('/__mybay/session-complete')) {
      return {
        required: true,
        compatible: false,
        reason: "missing_session_complete_router",
        actionRequired: "redeploy"
      };
    }

    // Check if secure router matches
    if (!secureRule || !secureRule.includes('/__mybay/session-complete')) {
      return {
        required: true,
        compatible: false,
        reason: "missing_session_complete_router",
        actionRequired: "redeploy"
      };
    }

    // Check priority
    if (priority !== '9999' || securePriority !== '9999') {
      return {
        required: true,
        compatible: false,
        reason: "missing_priority",
        actionRequired: "redeploy"
      };
    }

    // Check service
    if (service !== 'mybay-console-service@file' || secureService !== 'mybay-console-service@file') {
      return {
        required: true,
        compatible: false,
        reason: "missing_console_service",
        actionRequired: "redeploy"
      };
    }

    // session-complete router 不应有 middlewares=...auth
    const middlewares = labels[`${routerPrefix}.middlewares`] || '';
    const secureMiddlewares = labels[`${routerPrefix}-secure.middlewares`] || '';
    if (middlewares.includes('auth') || secureMiddlewares.includes('auth')) {
      return {
        required: true,
        compatible: false,
        reason: "has_forwardauth_on_session_complete",
        actionRequired: "redeploy"
      };
    }

    return {
      required: true,
      compatible: true
    };
  } catch (err) {
    console.error("[checkAccessBridgeCompatibility Error]", err);
    return {
      required: true,
      compatible: true,
      reason: "unknown"
    };
  }
}
