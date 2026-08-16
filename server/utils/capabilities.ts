import { requestTraefikInternal } from "./traefikInternalRequest";
import { resolveInstanceInternalApiKey } from "./instanceInternalApiKey";

export type CapabilityState = 'supported' | 'explicitly_unsupported' | 'unavailable';

export interface NormalizedRunsCapabilities {
  state: CapabilityState;
  runsSupported: boolean;
  toolProgressEvents: boolean;
  features: Record<string, boolean>;
  endpoints?: Record<string, any>;
  raw?: any;
}

/** Normalize both the official Hermes feature object and the legacy array. */
export function normalizeHermesRunsCapabilities(payload: any): NormalizedRunsCapabilities {
  const source = payload && typeof payload === "object" ? payload : {};
  const features = source.features && typeof source.features === "object"
    ? source.features
    : null;

  if (features) {
    const normalizedFeatures: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(features)) {
      if (typeof value === "boolean") normalizedFeatures[key] = value;
    }
    const runsSupported = [
      "run_submission",
      "run_status"
    ].every((key) => normalizedFeatures[key] === true);

    return {
      state: runsSupported ? "supported" : "explicitly_unsupported",
      runsSupported,
      toolProgressEvents: normalizedFeatures.tool_progress_events === true,
      features: normalizedFeatures,
      endpoints: source.endpoints && typeof source.endpoints === "object" ? source.endpoints : undefined,
      raw: source
    };
  }

  if (Array.isArray(source.capabilities)) {
    const runsSupported = source.capabilities.includes("runs");
    return {
      state: runsSupported ? "supported" : "explicitly_unsupported",
      runsSupported,
      toolProgressEvents: runsSupported,
      features: {},
      raw: source
    };
  }

  if (typeof source.runsSupported === "boolean") {
    return {
      state: source.runsSupported ? "supported" : "explicitly_unsupported",
      runsSupported: source.runsSupported,
      toolProgressEvents: source.toolProgressEvents === true,
      features: source.features && typeof source.features === "object" ? source.features : {},
      endpoints: source.endpoints && typeof source.endpoints === "object" ? source.endpoints : undefined,
      raw: source
    };
  }

  return { state: "unavailable", runsSupported: false, toolProgressEvents: false, features: {} };
}

interface CapabilityCacheEntry {
  state: CapabilityState;
  normalized?: NormalizedRunsCapabilities;
  timestamp: number;
  cacheKey: string;
}

// In-memory cache
const capabilitiesCache = new Map<string, CapabilityCacheEntry>();

/**
 * Probes the capabilities of the target Hermes instance
 * Returns one of:
 * - 'supported': fully supports the /v1/runs API
 * - 'explicitly_unsupported': explicitly does NOT support runs, safe to degrade to sync chat turn
 * - 'unavailable': connection or server transient error, do NOT degrade or cache as unsupported
 */
export async function probeCapabilities(instance: any): Promise<CapabilityState> {
  return (await probeCapabilitiesDetailed(instance)).state;
}

export async function probeCapabilitiesDetailed(instance: any): Promise<NormalizedRunsCapabilities> {
  const cacheKey = `${instance.id}:${instance.status}:${instance.updated_at}:${instance.version || 'unknown'}`;
  
  const cached = capabilitiesCache.get(instance.id);
  if (cached && cached.cacheKey === cacheKey && Date.now() - cached.timestamp < 30 * 60 * 1000) {
    return cached.normalized || { state: cached.state, runsSupported: cached.state === "supported", toolProgressEvents: cached.state === "supported", features: {} };
  }

  const unavailable: NormalizedRunsCapabilities = { state: 'unavailable', runsSupported: false, toolProgressEvents: false, features: {} };
  const keyResolution = resolveInstanceInternalApiKey(instance);
  if (!keyResolution.ok || !keyResolution.apiKey) {
    return unavailable;
  }
  const apiKey = keyResolution.apiKey;

  let normalized: NormalizedRunsCapabilities = unavailable;

  try {
    const response = await requestTraefikInternal({
      instanceId: String(instance.id),
      method: "GET",
      path: "/v1/capabilities",
      apiKey,
      timeoutMs: 5000,
    });

    if (response.ok && response.statusCode === 200 && response.json) {
      normalized = normalizeHermesRunsCapabilities(response.json);
    }
  } catch {
    normalized = unavailable;
  }

  // Timeouts, 503, invalid JSON and routing failures are unavailable and must not be cached as unsupported.
  if (normalized.state !== 'unavailable') {
    capabilitiesCache.set(instance.id, {
      state: normalized.state,
      normalized,
      timestamp: Date.now(),
      cacheKey,
    });
  }

  return normalized;
}


