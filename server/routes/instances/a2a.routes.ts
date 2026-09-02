import { Router, Response } from "express";
import { dbAdapter } from "../../db";
import { AuthenticatedRequest, authenticateToken } from "../../middlewares/auth";
import { encrypt } from "../../crypto";
import crypto from "node:crypto";
import {
  A2A_COLLABORATION_NETWORK,
  A2A_INTERNAL_PORT,
  getA2AInternalUrl,
  A2A_MAX_CAPABILITIES_PER_PEER,
  isValidA2ACapability,
  isValidA2AAgentName,
  normalizeA2AAgentName,
  normalizeA2APeerCapabilities,
  normalizeA2APeerIds,
  supportsA2AByVersion,
} from "../../../shared/a2aConfig";
import { ensureA2ABearerToken } from "../../services/a2aRuntimeConfig";
import { probeA2AAgentCard } from "../../services/a2aProbe";
import { groupA2AOrchestrations, readA2AActivities } from "../../services/a2aActivity";
import { docker } from "../../lib/docker";

function parseConfig(instance: any): any {
  try {
    return typeof instance?.config_json === "string" ? JSON.parse(instance.config_json) : (instance?.config_json || {});
  } catch {
    return {};
  }
}

function canAccess(instance: any, req: AuthenticatedRequest): boolean {
  return getOwnerId(instance) === req.user.id || req.user.role === "admin" || req.user.role === "super_admin";
}

function getOwnerId(instance: any): string {
  return String(instance?.owner_id || instance?.user_id || "");
}

function resolveVersion(instance: any): string {
  return String(instance?.resolved_version || instance?.agent_image_tag || instance?.agent_version || "");
}

function isSelectablePeer(instance: any): boolean {
  return instance?.archived !== true
    && instance?.deleted_at == null
    && String(instance?.status || "").toLowerCase() !== "deleted";
}

function safeA2ARoute(
  handler: (req: AuthenticatedRequest, res: Response) => Promise<unknown>,
) {
  return async (req: AuthenticatedRequest, res: Response) => {
    try {
      await handler(req, res);
    } catch (error) {
      console.error("[A2A Control Plane] Request failed:", error);
      if (!res.headersSent) res.status(500).json({ code: "A2A_CONTROL_PLANE_FAILED" });
    }
  };
}

async function buildA2AView(instance: any, req: AuthenticatedRequest) {
  const config = parseConfig(instance);
  const ownerId = getOwnerId(instance);
  const instances = await dbAdapter.getInstances(req.user.id, req.user.role);
  const configuredPeerIds = normalizeA2APeerIds(config.a2aPeerIds, instance.id);
  const configuredPeerCapabilities = normalizeA2APeerCapabilities(config.a2aPeerCapabilities, configuredPeerIds);
  const candidates = instances
    .filter((item: any) => item.id !== instance.id && getOwnerId(item) === ownerId && isSelectablePeer(item))
    .map((item: any) => {
      const peerConfig = parseConfig(item);
      const version = resolveVersion(item);
      return {
        id: item.id,
        name: normalizeA2AAgentName(peerConfig.a2aAgentName, item.name || item.id),
        version,
        supported: supportsA2AByVersion(version, item.capabilities),
        enabled: peerConfig.a2aEnabled === true,
        status: item.status,
        capabilities: configuredPeerCapabilities[item.id] || [],
      };
    });
  const version = resolveVersion(instance);
  return {
    instanceId: instance.id,
    version,
    supported: supportsA2AByVersion(version, instance.capabilities),
    enabled: config.a2aEnabled === true,
    agentName: normalizeA2AAgentName(config.a2aAgentName, instance.name || instance.id),
    port: A2A_INTERNAL_PORT,
    exposure: "internal_only",
    internalUrl: getA2AInternalUrl(instance.id),
    hasToken: Boolean(config.a2aBearerToken),
    peerIds: configuredPeerIds,
    peers: candidates,
    rateLimit: Math.min(600, Math.max(1, Number(config.a2aRateLimit) || 60)),
    maxPingPongTurns: Math.min(20, Math.max(1, Number(config.a2aMaxPingPongTurns) || 5)),
  };
}

export function createA2ARoutes() {
  const router = Router();

  router.use("/:id/a2a", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get("/:id/a2a", authenticateToken, safeA2ARoute(async (req: AuthenticatedRequest, res: Response) => {
    const instance: any = await dbAdapter.getInstanceById(req.params.id);
    if (!instance) return res.status(404).json({ code: "INSTANCE_NOT_FOUND" });
    if (!canAccess(instance, req)) return res.status(403).json({ code: "FORBIDDEN" });
    return res.json(await buildA2AView(instance, req));
  }));

  router.get("/:id/a2a/status", authenticateToken, safeA2ARoute(async (req: AuthenticatedRequest, res: Response) => {
    const instance: any = await dbAdapter.getInstanceById(req.params.id);
    if (!instance) return res.status(404).json({ code: "INSTANCE_NOT_FOUND" });
    if (!canAccess(instance, req)) return res.status(403).json({ code: "FORBIDDEN" });
    const config = parseConfig(instance);
    if (config.a2aEnabled !== true) return res.json({ state: "disabled" });
    const ownStatus = await probeA2AAgentCard(instance.id);
    const trustedPeerIds = normalizeA2APeerIds(config.a2aPeerIds, instance.id);
    const peers = await Promise.all(trustedPeerIds.map(async (peerId) => ({
      id: peerId,
      ...await probeA2AAgentCard(peerId),
    })));
    return res.json({ ...ownStatus, peers, generatedAt: new Date().toISOString() });
  }));

  router.get("/:id/a2a/activity", authenticateToken, safeA2ARoute(async (req: AuthenticatedRequest, res: Response) => {
    const instance: any = await dbAdapter.getInstanceById(req.params.id);
    if (!instance) return res.status(404).json({ code: "INSTANCE_NOT_FOUND" });
    if (!canAccess(instance, req)) return res.status(403).json({ code: "FORBIDDEN" });
    const ownerId = getOwnerId(instance);
    const instances = await dbAdapter.getInstances(req.user.id, req.user.role);
    const peers = instances.filter((item: any) => item.id !== instance.id && getOwnerId(item) === ownerId && isSelectablePeer(item));
    const peerNames = new Map<string, string>(peers.map((peer: any): [string, string] => {
      const peerConfig = parseConfig(peer);
      return [String(peer.id), normalizeA2AAgentName(peerConfig.a2aAgentName, peer.name || peer.id)];
    }));
    const trustedPeerIds = new Set(normalizeA2APeerIds(parseConfig(instance).a2aPeerIds, instance.id));
    const peerIpToId = new Map<string, string>();
    await Promise.all(peers.filter((peer: any) => trustedPeerIds.has(String(peer.id))).map(async (peer: any) => {
      try {
        const details = await docker.getContainer(peer.container_id || `mybay-agent-${peer.id}`).inspect();
        const ip = String(details?.NetworkSettings?.Networks?.[A2A_COLLABORATION_NETWORK]?.IPAddress || "").trim();
        if (ip) peerIpToId.set(ip, String(peer.id));
      } catch {
        // Activity history remains readable with its raw peer identity when Docker is unavailable.
      }
    }));
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12));
    const activities = readA2AActivities({ instanceId: String(instance.id), limit, peerNames, peerIpToId, trustedPeerIds: [...trustedPeerIds] });
    return res.json({
      activities,
      orchestrations: groupA2AOrchestrations(activities),
      generatedAt: new Date().toISOString(),
    });
  }));

  router.put("/:id/a2a", authenticateToken, safeA2ARoute(async (req: AuthenticatedRequest, res: Response) => {
    const instance: any = await dbAdapter.getInstanceById(req.params.id);
    if (!instance) return res.status(404).json({ code: "INSTANCE_NOT_FOUND" });
    if (!canAccess(instance, req)) return res.status(403).json({ code: "FORBIDDEN" });
    const version = resolveVersion(instance);
    if (!supportsA2AByVersion(version, instance.capabilities)) {
      return res.status(409).json({ code: "A2A_VERSION_UNSUPPORTED", params: { version } });
    }
    const enabled = req.body?.enabled === true;
    const currentConfig = parseConfig(instance);
    const nextAgentName = normalizeA2AAgentName(
      req.body?.agentName ?? currentConfig.a2aAgentName,
      instance.name || instance.id,
    );
    if (!isValidA2AAgentName(nextAgentName)) {
      return res.status(400).json({ code: "A2A_AGENT_NAME_INVALID" });
    }
    const requestedPeerIds = normalizeA2APeerIds(req.body?.peerIds, instance.id);
    if (Array.isArray(req.body?.peerIds) && requestedPeerIds.length !== new Set(req.body.peerIds.map(String).filter((id: string) => id !== instance.id)).size) {
      return res.status(400).json({ code: "A2A_PEER_LIST_INVALID" });
    }
    const available = await dbAdapter.getInstances(req.user.id, req.user.role);
    const ownerId = getOwnerId(instance);
    const allowedPeerIds = new Set(available
      .filter((item: any) => item.id !== instance.id && getOwnerId(item) === ownerId && isSelectablePeer(item))
      .map((item: any) => item.id));
    if (requestedPeerIds.some((id) => !allowedPeerIds.has(id))) {
      return res.status(400).json({ code: "A2A_PEER_NOT_ACCESSIBLE" });
    }
    const rawPeerCapabilities = req.body?.peerCapabilities;
    if (rawPeerCapabilities != null && (!rawPeerCapabilities || typeof rawPeerCapabilities !== "object" || Array.isArray(rawPeerCapabilities))) {
      return res.status(400).json({ code: "A2A_CAPABILITIES_INVALID" });
    }
    for (const [peerId, rawCapabilities] of Object.entries(rawPeerCapabilities || {})) {
      if (!requestedPeerIds.includes(peerId) || !Array.isArray(rawCapabilities) || rawCapabilities.length > A2A_MAX_CAPABILITIES_PER_PEER
        || rawCapabilities.some((capability) => !isValidA2ACapability(capability))) {
        return res.status(400).json({ code: "A2A_CAPABILITIES_INVALID" });
      }
    }
    const peerCapabilities = normalizeA2APeerCapabilities(rawPeerCapabilities, requestedPeerIds);
    const config = currentConfig;
    config.a2aEnabled = enabled;
    config.a2aAgentName = nextAgentName;
    config.a2aPeerIds = requestedPeerIds;
    config.a2aPeerCapabilities = peerCapabilities;
    config.a2aPort = A2A_INTERNAL_PORT;
    config.a2aExposure = "internal_only";
    config.a2aRateLimit = Math.min(600, Math.max(1, Number(req.body?.rateLimit) || 60));
    config.a2aMaxPingPongTurns = Math.min(20, Math.max(1, Number(req.body?.maxPingPongTurns) || 5));
    if (enabled) ensureA2ABearerToken(config);
    await dbAdapter.updateInstanceConfig(instance.id, JSON.stringify(config));
    await dbAdapter.insertAuditLog({
      instance_id: instance.id,
      action: "update_a2a_config",
      user_id: req.user.id,
      timestamp: new Date().toISOString(),
      details: `A2A ${enabled ? "enabled" : "disabled"}; trusted peers=${requestedPeerIds.length}; capability tags=${Object.values(peerCapabilities).reduce((sum, values) => sum + values.length, 0)}; internal-only`,
    });
    return res.json({ success: true, redeployRequired: true, config: await buildA2AView({ ...instance, config_json: JSON.stringify(config) }, req) });
  }));

  router.post("/:id/a2a/rotate-token", authenticateToken, safeA2ARoute(async (req: AuthenticatedRequest, res: Response) => {
    const instance: any = await dbAdapter.getInstanceById(req.params.id);
    if (!instance) return res.status(404).json({ code: "INSTANCE_NOT_FOUND" });
    if (!canAccess(instance, req)) return res.status(403).json({ code: "FORBIDDEN" });
    const config = parseConfig(instance);
    config.a2aBearerToken = encrypt(`mb_a2a_${crypto.randomBytes(32).toString("hex")}`);
    await dbAdapter.updateInstanceConfig(instance.id, JSON.stringify(config));
    await dbAdapter.insertAuditLog({
      instance_id: instance.id,
      action: "rotate_a2a_token",
      user_id: req.user.id,
      timestamp: new Date().toISOString(),
      details: "Rotated A2A bearer token; redeploy required",
    });
    return res.json({ success: true, redeployRequired: true });
  }));

  return router;
}
