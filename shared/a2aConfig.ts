import { inferAgentVersionCapabilities } from "./agentVersionCapabilities";

export const A2A_INTERNAL_PORT = 9900;
export const A2A_COLLABORATION_NETWORK = "mybay-a2a-internal";
export const A2A_MAX_PEERS = 32;
export const A2A_MAX_CAPABILITIES_PER_PEER = 8;
export const A2A_MAX_CAPABILITY_LENGTH = 32;

export function normalizeA2AAgentName(value: unknown, fallback: string): string {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  return (normalized || fallback).slice(0, 64);
}

export function isValidA2AAgentName(value: unknown): boolean {
  const name = String(value || "").trim();
  return name.length >= 1 && name.length <= 64 && !/[\r\n\t]/.test(name);
}

export function normalizeA2APeerIds(value: unknown, selfId?: string): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .map(String)
    .map((item) => item.trim())
    .filter((item) => /^[A-Za-z0-9-]{1,128}$/.test(item) && item !== selfId)))
    .slice(0, A2A_MAX_PEERS);
}

export function normalizeA2ACapability(value: unknown): string {
  return String(value || "").trim().toLowerCase().slice(0, A2A_MAX_CAPABILITY_LENGTH);
}

export function isValidA2ACapability(value: unknown): boolean {
  const capability = normalizeA2ACapability(value);
  return capability.length > 0 && capability.length <= A2A_MAX_CAPABILITY_LENGTH && /^[a-z0-9][a-z0-9._-]*$/.test(capability);
}

export function normalizeA2APeerCapabilities(value: unknown, peerIds: string[]): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const result: Record<string, string[]> = {};
  for (const peerId of peerIds) {
    const raw = source[peerId];
    if (!Array.isArray(raw)) continue;
    const capabilities = Array.from(new Set(raw
      .map(normalizeA2ACapability)
      .filter(isValidA2ACapability)))
      .slice(0, A2A_MAX_CAPABILITIES_PER_PEER);
    if (capabilities.length) result[peerId] = capabilities;
  }
  return result;
}

export function supportsA2AByVersion(version: unknown, explicitCapabilities?: unknown): boolean {
  if (Array.isArray(explicitCapabilities) && explicitCapabilities.map(String).map((item) => item.toLowerCase()).includes("a2a")) {
    return true;
  }
  return inferAgentVersionCapabilities(version).includes("a2a");
}

export function getA2AInternalUrl(instanceId: string): string {
  return `http://mybay-agent-${instanceId}:${A2A_INTERNAL_PORT}`;
}
