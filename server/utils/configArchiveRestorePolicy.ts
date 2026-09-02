type RestoreInstanceRecord = {
  status?: unknown;
  container_id?: unknown;
  container_name?: unknown;
  host_port?: unknown;
  port?: unknown;
  config_json?: unknown;
};

function parsePort(value: unknown): number | null {
  const port = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

export function collectReservedInstancePorts(instances: RestoreInstanceRecord[]): number[] {
  const ports = new Set<number>();

  for (const instance of instances) {
    let config: Record<string, unknown> = {};
    if (typeof instance.config_json === "string" && instance.config_json.trim()) {
      try {
        const parsed = JSON.parse(instance.config_json);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) config = parsed;
      } catch {
        // A malformed legacy config must not prevent a restore; direct fields
        // still contribute their reserved ports below.
      }
    }

    for (const value of [instance.host_port, instance.port, config.host_port, config.port]) {
      const port = parsePort(value);
      if (port !== null) ports.add(port);
    }
  }

  return [...ports];
}

export function isContainerlessInstanceEligibleForDeployment(instance: RestoreInstanceRecord): boolean {
  return ["stopped", "error", "failed", "deploy_failed"].includes(
    String(instance.status || "").toLowerCase(),
  )
    && !String(instance.container_id || "").trim()
    && !String(instance.container_name || "").trim();
}

export function disableCredentiallessA2AForRestore(config: Record<string, any>): boolean {
  if (config.a2aEnabled !== true || String(config.a2aBearerToken || "").trim()) return false;
  config.a2aEnabled = false;
  config.a2aPeerIds = [];
  config.hasA2aBearerToken = false;
  return true;
}
