// Export only machine enums, UUID correlation IDs and timestamps. Never copy
// free-form labels, errors, names, logs, configuration or Runtime payloads.
const CHECKS = ["CONTAINER_STATE", "CONTAINER_HEALTH", "PORT_MAPPING", "DOCKER_NETWORK", "DISK_SPACE", "PHYSICAL_STATE", "DASHBOARD_AUTH", "GATEWAY", "MODEL_CONFIG", "MODEL_RUNTIME", "CHANNEL", "CHAT_READINESS"];
const REASONS = ["CHANNEL_CONFIG_UNAVAILABLE", "CHANNEL_CONNECTING", "CHAT_INITIALIZING", "CHAT_ROUTE_UNAVAILABLE", "CONTAINER_NOT_FOUND", "CONTAINER_NOT_RUNNING", "CONTAINER_UNHEALTHY", "DASHBOARD_AUTH_INCOMPLETE", "DISK_SPACE_CRITICAL", "DISK_SPACE_LOW", "DISK_SPACE_UNAVAILABLE", "DOCKER_NETWORK_MISSING", "GATEWAY_INITIALIZING", "GATEWAY_UNHEALTHY", "HEALTHCHECK_NOT_CONFIGURED", "MODEL_CONFIG_REQUIRED", "MODEL_CONFIG_UNAVAILABLE", "MODEL_CONFIG_VERIFYING", "MODEL_RUNTIME_NOT_TESTED", "MODEL_RUNTIME_UNAVAILABLE", "PHYSICAL_STATE_DIVERGED", "PORT_MAPPING_MISSING"];
const pick = (value: unknown, allowed: string[]) => typeof value === "string" && allowed.includes(value) ? value : "unknown";
const obj = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const uuid = (value: unknown) => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value) ? value : null;
const time = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;

export function buildLocalDiagnosticExport(report: unknown, version: unknown, reportId: unknown) {
  const data = obj(report), instance = obj(data.instance), capabilities = obj(data.capabilities);
  return {
    schema: "mybay.local-diagnostic.v1",
    reportId: uuid(reportId),
    generatedAt: time(data.generatedAt),
    applicationVersion: typeof version === "string" && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version) ? version : "unknown",
    deploymentMode: pick(capabilities.deploymentMode, ["desktop", "lan", "server"]),
    instanceId: uuid(instance.id),
    instanceStatus: pick(instance.status, ["running", "stopped", "failed", "pending", "deploying", "stopping", "deleted"]),
    checks: (Array.isArray(data.checks) ? data.checks : []).slice(0, 32).map(item => {
      const check = obj(item);
      return {
        code: pick(check.code, CHECKS),
        domain: pick(check.domain, ["container", "host", "dashboard", "chat", "model", "channel"]),
        status: pick(check.status, ["pass", "warning", "fail", "checking", "not_applicable"]),
        reasonCode: check.reasonCode == null ? null : pick(check.reasonCode, REASONS),
      };
    }),
    privacy: "No chat, user files, logs, environment, credentials, addresses or instance names. Correlation IDs and timestamps are included. Local export only.",
  };
}

export type LocalDiagnosticExport = ReturnType<typeof buildLocalDiagnosticExport>;

/** Apply the same allowlist again before presenting or downloading an API response. */
export function readLocalDiagnosticExport(raw: unknown): LocalDiagnosticExport | null {
  const item = obj(raw);
  if (item.schema !== "mybay.local-diagnostic.v1") return null;
  return buildLocalDiagnosticExport({ generatedAt: item.generatedAt,
    instance: { id: item.instanceId, status: item.instanceStatus },
    capabilities: { deploymentMode: item.deploymentMode }, checks: item.checks,
  }, item.applicationVersion, item.reportId);
}
