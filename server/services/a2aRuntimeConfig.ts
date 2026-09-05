import crypto from "node:crypto";
import { dbAdapter } from "../db";
import { decrypt, encrypt } from "../crypto";
import { a2aRelayToken, a2aRelayUrl, a2aTrackingEnabled } from './a2aRelayConfig';
import {
  A2A_INTERNAL_PORT,
  getA2AInternalUrl,
  normalizeA2AAgentName,
  normalizeA2APeerCapabilities,
  normalizeA2APeerIds,
} from "../../shared/a2aConfig";

export type ResolvedA2APeer = {
  instanceId: string;
  name: string;
  url: string;
  encryptedToken: string;
  capabilities: string[];
};

export function ensureA2ABearerToken(config: any): { encryptedToken: string; generated: boolean } {
  if (typeof config?.a2aBearerToken === "string" && config.a2aBearerToken.trim()) {
    return { encryptedToken: config.a2aBearerToken, generated: false };
  }
  const encryptedToken = encrypt(`mb_a2a_${crypto.randomBytes(32).toString("hex")}`);
  config.a2aBearerToken = encryptedToken;
  return { encryptedToken, generated: true };
}

export function buildA2ARuntimeEnv(config: any): Record<string, string> {
  const revisionEnv: Record<string, string> = typeof config?.a2aRevision === "string" ? { MYBAY_A2A_REVISION: config.a2aRevision } : {};
  if (config?.a2aEnabled !== true) return revisionEnv;
  const token = config.a2aBearerToken ? decrypt(config.a2aBearerToken) : "";
  if (!token) throw new Error("A2A_TOKEN_REQUIRED");
  return {
    ...revisionEnv,
    A2A_BEARER_TOKEN: token,
    A2A_HOST: "0.0.0.0",
    A2A_PORT: String(A2A_INTERNAL_PORT),
    A2A_AGENT_NAME: normalizeA2AAgentName(config.a2aAgentName, config.name || "MyBay Agent"),
    A2A_PUBLIC_URL: String(config.a2aPublicUrl || getA2AInternalUrl(config.instanceId || config.id || "agent")),
    A2A_RATE_LIMIT: String(Math.min(600, Math.max(1, Number(config.a2aRateLimit) || 60))),
    A2A_MAX_PINGPONG_TURNS: String(Math.min(20, Math.max(1, Number(config.a2aMaxPingPongTurns) || 5))),
  };
}

export async function hydrateA2ARuntimePeers(instanceId: string, config: any): Promise<void> {
  config.instanceId = instanceId;
  config.a2aResolvedPeers = [];
  if (config.a2aEnabled !== true) return;
  const peerIds = normalizeA2APeerIds(config.a2aPeerIds, instanceId);
  const peerCapabilities = normalizeA2APeerCapabilities(config.a2aPeerCapabilities, peerIds);
  const resolved: ResolvedA2APeer[] = [];
  for (const peerId of peerIds) {
    const peer: any = await dbAdapter.getInstanceById(peerId);
    if (!peer) continue;
    let peerConfig: any = {};
    try {
      peerConfig = typeof peer.config_json === "string" ? JSON.parse(peer.config_json) : (peer.config_json || {});
    } catch {
      continue;
    }
    if (peerConfig.a2aEnabled !== true || !peerConfig.a2aBearerToken) continue;
    resolved.push({
      instanceId: peerId,
      name: normalizeA2AAgentName(peerConfig.a2aAgentName, peer.name || peerId),
      url: a2aTrackingEnabled(instanceId) ? a2aRelayUrl(instanceId, peerId) : getA2AInternalUrl(peerId),
      encryptedToken: a2aTrackingEnabled(instanceId) ? encrypt(a2aRelayToken(instanceId)) : peerConfig.a2aBearerToken,
      capabilities: peerCapabilities[peerId] || [],
    });
  }
  config.a2aResolvedPeers = resolved;
}

export function buildA2AYamlConfig(config: any): Record<string, any> {
  if (config?.a2aEnabled !== true) return {};
  const peers = Array.isArray(config.a2aResolvedPeers) ? config.a2aResolvedPeers : [];
  const a2aAgents: Record<string, any> = {};
  for (const peer of peers as ResolvedA2APeer[]) {
    const token = peer.encryptedToken ? decrypt(peer.encryptedToken) : "";
    if (!token) continue;
    a2aAgents[peer.instanceId] = {
      url: peer.url,
      auth: { type: "bearer", token },
      timeout: 120,
      ...(peer.capabilities?.length ? { capabilities: peer.capabilities } : {}),
    };
  }
  return {
    gateway: {
      platforms: {
        a2a: { enabled: true, extra: { port: A2A_INTERNAL_PORT } },
      },
    },
    ...(Object.keys(a2aAgents).length ? { a2a_agents: a2aAgents } : {}),
  };
}
