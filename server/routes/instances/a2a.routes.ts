import { getA2ATaskLink, a2aTaskResultText, updateA2ATaskLink } from '../../services/a2aTaskLinks';
import { readA2ADiskResult } from '../../services/a2aDiskResult';
import { cancelA2ATask } from '../../services/a2aTaskCancel';
import { readStoreCollections } from "../../localStore";
import { sameA2ARecoverySource, readA2ARecoverySource, resolveA2ARecoveryEvidence } from "../../../shared/a2aRecovery";
import { Router, Response } from "express";
import { dbAdapter } from "../../db";
import { AuthenticatedRequest, authenticateToken } from "../../middlewares/auth";
import { encrypt, decrypt } from "../../crypto";
import { refreshMappedA2ATask } from '../../services/a2aTrackedTransport';
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
import { probeA2ATools } from "../../services/a2aToolProbe";

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

function getStoredPeerTransport(peer: any): { peerId: string; url: string } | null {
  const peerId = String(peer?.id || "").trim();
  if (normalizeA2APeerIds([peerId])[0] !== peerId) return null;
  return { peerId, url: getA2AInternalUrl(peerId) };
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
        name: normalizeA2AAgentName(item.name, peerConfig.a2aAgentName || item.id),
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
    applicationState: await getApplicationState(instance),
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

async function getApplicationState(instance: any): Promise<"pending" | "applied" | "unknown"> {
  const revision = parseConfig(instance).a2aRevision;
  if (!revision) return "unknown";
  try {
    const details = await docker.getContainer(instance.container_id || `mybay-agent-${instance.id}`).inspect();
    return details.Config?.Env?.includes(`MYBAY_A2A_REVISION=${revision}`) ? "applied" : "pending";
  } catch {
    return "unknown";
  }
}

export function createA2ARoutes() {
  const router = Router();
  router.post('/:id/a2a/tasks/cancel', authenticateToken, safeA2ARoute(async (req: AuthenticatedRequest, res: Response) => {
    const instance: any = await dbAdapter.getInstanceById(req.params.id);
    if (!instance) return res.status(404).json({ code: 'INSTANCE_NOT_FOUND' });
    if (!canAccess(instance, req)) return res.status(403).json({ code: 'FORBIDDEN' });
    const source = readA2ARecoverySource(req.body);
    if (!source) return res.status(400).json({ code: 'INVALID_REQUEST' });
    const config = parseConfig(instance);
    const available = await dbAdapter.getInstances(req.user.id, req.user.role);
    const peer: any = available.find((item: any) => String(item.id) === source.peerId);
    if (!config.a2aEnabled || !normalizeA2APeerIds(config.a2aPeerIds, instance.id).includes(source.peerId) || !peer || !isSelectablePeer(peer) || getOwnerId(peer) !== getOwnerId(instance)) return res.status(403).json({ code: 'FORBIDDEN' });
    const peerConfig = parseConfig(peer);
    const transport = getStoredPeerTransport(peer);
    const link = getA2ATaskLink(String(instance.id), source.peerId, source.taskId);
    if (!transport || !peerConfig.a2aEnabled || !peerConfig.a2aBearerToken || !link?.remoteTaskId || link.contextId !== source.contextId) return res.status(409).json({ code: 'A2A_CANCEL_UNCONFIRMED' });
    try {
      await cancelA2ATask(link, async remoteId => {
        const id = crypto.randomUUID();
        const response = await fetch(transport.url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${decrypt(peerConfig.a2aBearerToken)}` }, body: JSON.stringify({ jsonrpc: '2.0', id, method: 'CancelTask', params: { id: remoteId } }) });
        if (!response.ok || !response.body) throw Error('A2A_CANCEL_UNCONFIRMED');
        const reader = response.body.getReader(); let text = ''; let bytes = 0; const decoder = new TextDecoder();
        try { while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.length; if (bytes > 256 * 1024) throw Error('A2A_CANCEL_UNCONFIRMED'); text += decoder.decode(chunk.value, { stream: true }); } }
        finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        const rpc = JSON.parse(text + decoder.decode());
        if (rpc.id !== id || rpc.error) throw Error('A2A_CANCEL_UNCONFIRMED');
        return rpc.result?.task || rpc.result;
      });
      return res.json({ success: true, state: 'cancelled' });
    } catch { return res.status(409).json({ code: 'A2A_CANCEL_UNCONFIRMED' }); }
  }));

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
    const applicationState = await getApplicationState(instance);
    if (config.a2aEnabled !== true) return res.json({ state: "disabled", applicationState });
    const ownStatus = await probeA2AAgentCard(instance.id);
    const toolState = ownStatus.state === "ready" ? await probeA2ATools(instance) : "unknown";
    const trustedPeerIds = normalizeA2APeerIds(config.a2aPeerIds, instance.id);
    const available = await dbAdapter.getInstances(req.user.id, req.user.role);
    const peers = await Promise.all(trustedPeerIds.map(async (peerId) => {
      const peer = available.find((item: any) => item.id === peerId && getOwnerId(item) === getOwnerId(instance) && isSelectablePeer(item));
      if (!peer) return { id: peerId, state: "unknown", setupIssue: "unavailable" };
      const peerConfig = parseConfig(peer);
      const peerApplicationState = await getApplicationState(peer);
      const setupIssue = !supportsA2AByVersion(resolveVersion(peer), peer.capabilities) ? "unsupported"
        : peerConfig.a2aEnabled !== true ? "disabled"
        : peerApplicationState === "pending" ? "pending"
        : peer.status !== "running" ? "not_running"
        : peerApplicationState === "unknown" ? "unknown" : null;
      const live = peerConfig.a2aEnabled === true ? await probeA2AAgentCard(peerId) : { state: "disabled" };
      return { id: peerId, ...live, enabled: peerConfig.a2aEnabled === true, applicationState: peerApplicationState, setupIssue };
    }));
    return res.json({ ...ownStatus, peers, applicationState, toolState, generatedAt: new Date().toISOString() });
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
      return [String(peer.id), normalizeA2AAgentName(peer.name, peerConfig.a2aAgentName || peer.id)];
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
    const activities = readA2AActivities({ instanceId: String(instance.id), includeAll: true, peerNames, peerIpToId, trustedPeerIds: [...trustedPeerIds] });
    const hasSource = ['taskId', 'contextId', 'peerId'].some(key => req.query[key] !== undefined);
    const source = readA2ARecoverySource(req.query);
    if (hasSource && !source) return res.status(400).json({ code: "INVALID_REQUEST" });
    const recoveryEvidence = source ? resolveA2ARecoveryEvidence(source, activities) : null;
    let link = source ? getA2ATaskLink(String(instance.id), source.peerId, source.taskId) : undefined;
    if (source && link?.remoteTaskId && link.contextId === source.contextId && req.query.refreshRemote === '1' && trustedPeerIds.has(source.peerId)) {
      const peer = peers.find((row: any) => row.id === source.peerId);
      const peerConfig = peer ? parseConfig(peer) : null;
      const transport = getStoredPeerTransport(peer);
      if (transport && peerConfig?.a2aEnabled && peerConfig.a2aBearerToken) {
        try {
          link = await refreshMappedA2ATask(link, async remoteId => {
            const rpcId = crypto.randomUUID();
            const response = await fetch(transport.url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${decrypt(peerConfig.a2aBearerToken)}` }, body: JSON.stringify({ jsonrpc: '2.0', id: rpcId, method: 'GetTask', params: { id: remoteId, historyLength: 0 } }) });
            if (!response.ok || !response.body) throw Error('A2A_RESULT_UNAVAILABLE');
            const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
            try { while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.length; if (bytes > 2 * 1024 * 1024) throw Error('A2A_RESPONSE_LIMIT'); chunks.push(next.value); } }
            finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
            const rpc = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (rpc.id !== rpcId) throw Error('A2A_RESULT_UNAVAILABLE');
            if (rpc.error) throw Error(rpc.error.code === -32001 ? 'A2A_TASK_NOT_FOUND' : 'A2A_RESULT_UNAVAILABLE');
            return rpc.result?.task || rpc.result;
          });
        } catch (error: any) {
          const notFound = error.message === 'A2A_TASK_NOT_FOUND';
          const diskResult = notFound ? readA2ADiskResult(link) : undefined;
          link = updateA2ATaskLink(link.id, { lookupState: diskResult ? 'disk_reply' : notFound ? 'not_found' : 'unavailable', checkedAt: new Date().toISOString(), diskResult });
          // Preserve the last remote status; a disk reply is not a TaskStore terminal state.
        }
      }
    }
    if (recoveryEvidence && link?.remoteTaskId && link.contextId === source!.contextId) recoveryEvidence.remoteMapping = {
      remoteTaskId: link.remoteTaskId, remoteState: link.remoteState || 'unknown', recordState: link.state, updatedAt: link.updatedAt, result: a2aTaskResultText(link.task), lookupState: link.lookupState, checkedAt: link.checkedAt, diskResult: link.diskResult,
    };
    const activityStore = readStoreCollections(["chatRuns", "a2aTaskLinks"]);
    const mappingFor = (activity: any) => {
      const saved = activity.direction === "outbound" && activityStore.a2aTaskLinks.find(row => row.instanceId === instance.id && row.peerId === activity.peerId && row.callerTaskId === activity.taskId && row.contextId === activity.contextId);
      return saved?.remoteTaskId ? { remoteTaskId: saved.remoteTaskId, remoteState: saved.remoteState || "unknown", recordState: saved.state, updatedAt: saved.updatedAt, result: a2aTaskResultText(saved.task), lookupState: saved.lookupState, checkedAt: saved.checkedAt, diskResult: saved.diskResult } : null;
    };
    const recoveryRuns = activityStore.chatRuns.filter(run => run.instance_id === instance.id && run.user_id === ownerId && run.a2a_recovery_source);
    return res.json({
      ...(recoveryEvidence ? { recoveryEvidence } : {}),
      activities: activities.slice(0, limit).map(activity => ({ ...activity, remoteMapping: mappingFor(activity), recoveryAttempts: recoveryRuns.filter(run => sameA2ARecoverySource(run.a2a_recovery_source, { contextId: activity.contextId, taskId: activity.taskId, peerId: activity.peerId || "" })).sort((a,b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0,3).map(run => ({ runId: run.id, status: run.status, createdAt: run.created_at })) })),
      orchestrations: groupA2AOrchestrations(activities).slice(0, limit),
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
    config.a2aRevision = crypto.randomUUID();
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
    config.a2aRevision = crypto.randomUUID();
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
