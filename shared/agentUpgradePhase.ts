export const AGENT_UPGRADE_PHASES = [
  "queued",
  "pulling_image",
  "rebuilding",
  "health_check",
  "chat_ready",
  "completed",
  "rolling_back",
  "rolled_back",
  "failed",
] as const;

export type AgentUpgradePhase = (typeof AGENT_UPGRADE_PHASES)[number];

const KNOWN_PHASES = new Set<string>(AGENT_UPGRADE_PHASES);

export function normalizeAgentUpgradePhase(
  phase: unknown,
  upgradeStatus?: unknown,
): AgentUpgradePhase | "idle" {
  const normalizedPhase = String(phase || "").trim().toLowerCase();
  if (KNOWN_PHASES.has(normalizedPhase)) return normalizedPhase as AgentUpgradePhase;

  const normalizedStatus = String(upgradeStatus || "").trim().toLowerCase();
  if (normalizedStatus === "upgrading") return "queued";
  if (normalizedStatus === "success") return "completed";
  if (normalizedStatus === "failed") return "failed";
  return "idle";
}

export const AGENT_UPGRADE_TIMELINE_PHASES: AgentUpgradePhase[] = [
  "queued",
  "pulling_image",
  "rebuilding",
  "health_check",
  "chat_ready",
  "completed",
];
