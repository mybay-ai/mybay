/**
 * Hermes Agent version capabilities check utility
 */

export function supportsNativeDashboardBasicAuth(input: {
  agentImage?: string;
  agentImageTag?: string;
  agentVersion?: string;
  capabilities?: string[] | string | null;
  config?: any;
}): boolean {
  // 1. If capabilities contain native_dashboard_basic_auth, return true
  if (input.capabilities) {
    if (Array.isArray(input.capabilities)) {
      if (input.capabilities.includes("native_dashboard_basic_auth")) {
        return true;
      }
    } else if (typeof input.capabilities === "string") {
      const caps = input.capabilities.split(",").map(c => c.trim());
      if (caps.includes("native_dashboard_basic_auth")) {
        return true;
      }
    }
  }

  // 2. Extract versions from various fields
  const candidates = [
    input.agentVersion,
    input.agentImageTag,
    input.agentImage,
    input.config?.agent_version,
    input.config?.agent_image_tag,
    input.config?.agent_image,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const parsed = parseVersion(candidate);
    if (parsed) {
      if (isVersionGreaterOrEqual(parsed, [2026, 7, 20])) {
        return true;
      }
    }
  }

  return false;
}

function parseVersion(str: string): [number, number, number] | null {
  const match = str.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (match) {
    return [
      parseInt(match[1], 10),
      parseInt(match[2], 10),
      parseInt(match[3], 10)
    ];
  }
  return null;
}

function isVersionGreaterOrEqual(v1: [number, number, number], v2: [number, number, number]): boolean {
  if (v1[0] !== v2[0]) return v1[0] > v2[0];
  if (v1[1] !== v2[1]) return v1[1] > v2[1];
  return v1[2] >= v2[2];
}
