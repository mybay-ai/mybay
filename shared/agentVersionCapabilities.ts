import { compareHermesVersions, parseHermesVersion } from "./version";

export const AGENT_VERSION_CAPABILITY_IDS = [
  "core",
  "feishu",
  "a2a",
  "outbound_webhooks",
  "agent_redirects",
  "mcp_health",
  "bot_mode",
  "peer_dm",
  "group_rooms",
  "cron_continuity",
  "subagent_steering",
  "browser_control",
  "gateway_control",
] as const;

export type AgentVersionCapabilityId = typeof AGENT_VERSION_CAPABILITY_IDS[number];

interface CapabilityReleaseGate {
  id: Exclude<AgentVersionCapabilityId, "core" | "feishu">;
  calendarVersion: string;
  semverVersion: string;
}

// These gates intentionally follow stable release boundaries instead of commits on main.
// Bot Mode existed in earlier patch releases, but its complete built-in product surface is
// advertised from v0.21.0, so older releases are not over-promised by the control plane.
export const AGENT_VERSION_CAPABILITY_GATES: readonly CapabilityReleaseGate[] = [
  { id: "a2a", calendarVersion: "v2026.8.3", semverVersion: "v0.20.0" },
  { id: "outbound_webhooks", calendarVersion: "v2026.8.3", semverVersion: "v0.20.0" },
  { id: "agent_redirects", calendarVersion: "v2026.8.3", semverVersion: "v0.20.0" },
  { id: "mcp_health", calendarVersion: "v2026.8.16", semverVersion: "v0.20.2" },
  { id: "bot_mode", calendarVersion: "v2026.8.31", semverVersion: "v0.21.0" },
  { id: "peer_dm", calendarVersion: "v2026.8.31", semverVersion: "v0.21.0" },
  { id: "group_rooms", calendarVersion: "v2026.8.31", semverVersion: "v0.21.0" },
  { id: "cron_continuity", calendarVersion: "v2026.8.31", semverVersion: "v0.21.0" },
  { id: "subagent_steering", calendarVersion: "v2026.8.31", semverVersion: "v0.21.0" },
  { id: "browser_control", calendarVersion: "v2026.8.31", semverVersion: "v0.21.0" },
  { id: "gateway_control", calendarVersion: "v2026.8.31", semverVersion: "v0.21.0" },
] as const;

export function parseAgentVersionCapabilities(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim().toLowerCase()).filter(Boolean);
  }
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parseAgentVersionCapabilities(parsed);
  } catch {}
  return value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function usesPackageSemver(version: string): boolean {
  const parsed = parseHermesVersion(version);
  return !!parsed && parsed.parts[0] === 0;
}

export function inferAgentVersionCapabilities(versionValue: unknown): AgentVersionCapabilityId[] {
  const version = String(versionValue || "").trim();
  if (!parseHermesVersion(version)) return [];
  const semver = usesPackageSemver(version);
  return AGENT_VERSION_CAPABILITY_GATES
    .filter((gate) => compareHermesVersions(version, semver ? gate.semverVersion : gate.calendarVersion) >= 0)
    .map((gate) => gate.id);
}

export function orderAgentVersionCapabilities(capabilities: Iterable<string>): string[] {
  const unique = new Set(Array.from(capabilities, (item) => String(item).trim().toLowerCase()).filter(Boolean));
  const known = AGENT_VERSION_CAPABILITY_IDS.filter((id) => unique.delete(id));
  return [...known, ...Array.from(unique).sort()];
}
