import { resolveInstanceInternalApiKey } from "../../../utils/instanceInternalApiKey";
import { requestTraefikInternal } from "../../../utils/traefikInternalRequest";

export async function probeCodexRuntimeReadiness(instance: any) {
  const checkedAt = new Date().toISOString();
  const keyResolution = resolveInstanceInternalApiKey(instance);
  if (!keyResolution.ok || !keyResolution.apiKey) {
    return {
      gateway_ready: false,
      gateway_status: "auth_missing",
      gateway_error: keyResolution.error || "CODEX_BRIDGE_API_KEY_MISSING",
      gateway_services: {},
      checked_at: checkedAt,
      configured_channels: 0,
      connected_channels: 0,
      channel_status: {},
      chat_ready: false,
    };
  }

  const response = await requestTraefikInternal({
    instanceId: String(instance.id),
    method: "GET",
    path: "/v1/capabilities",
    apiKey: keyResolution.apiKey,
    timeoutMs: 5000,
  });
  const ready = Boolean(response.ok
    && response.json?.runtime === "codex"
    && response.json?.features?.run_submission === true
    && response.json?.features?.run_status === true);
  return {
    gateway_ready: ready,
    gateway_status: ready ? "running" : "unhealthy",
    gateway_error: ready ? null : (response.error || `CODEX_CAPABILITY_HTTP_${response.statusCode || 0}`),
    gateway_services: ready ? { codex_app_server: "running" } : {},
    checked_at: checkedAt,
    configured_channels: 0,
    connected_channels: 0,
    channel_status: {},
    chat_ready: ready,
  };
}
