import { docker } from "../lib/docker";

export type LocalInstanceTarget = {
  hostname: string;
  port: number;
  protocol: "http:";
};

const LOCAL_INSTANCE_TARGET_TTL_MS = 5 * 60 * 1000;
const targetCache = new Map<string, { target: LocalInstanceTarget; expiresAt: number }>();
const targetResolutions = new Map<string, Promise<LocalInstanceTarget>>();

export function invalidateLocalInstanceTarget(instanceId?: string): void {
  if (instanceId) {
    targetCache.delete(instanceId);
    return;
  }
  targetCache.clear();
}

async function inspectLocalInstanceTarget(instanceId: string): Promise<LocalInstanceTarget> {
  const containerName = `mybay-agent-${instanceId}`;
  const controlPlaneName = process.env.MYBAY_CONTROL_PANEL_CONTAINER || "mybay-local-control-panel";
  const [agentResult, controlPlaneResult] = await Promise.allSettled([
    docker.getContainer(containerName).inspect(),
    docker.getContainer(controlPlaneName).inspect(),
  ]);

  if (agentResult.status === "rejected") throw agentResult.reason;
  const networks = agentResult.value.NetworkSettings?.Networks || {};
  const networkName = "mybay-net-" + instanceId;
  const preferred = networks[networkName];
  const address = preferred?.IPAddress || Object.values(networks).find((item: any) => item?.IPAddress)?.IPAddress;
  if (!address) throw new Error("LOCAL_INSTANCE_NETWORK_UNAVAILABLE");

  if (controlPlaneResult.status === "fulfilled") {
    const controlPlaneNetworks = controlPlaneResult.value.NetworkSettings?.Networks || {};
    if (preferred && !controlPlaneNetworks[networkName]) {
      try {
        const controlPlane = docker.getContainer(controlPlaneName);
        await docker.getNetwork(networkName).connect({ Container: controlPlane.id });
      } catch (err: any) {
        const alreadyConnected = err?.statusCode === 409
          || String(err?.message || "").toLowerCase().includes("already exists");
        if (!alreadyConnected) throw err;
      }
    }
    const alreadySharesAgentNetwork = Object.keys(networks)
      .some(name => Boolean(controlPlaneNetworks[name]));
    if (!preferred && !alreadySharesAgentNetwork) {
      throw new Error("LOCAL_INSTANCE_NETWORK_UNAVAILABLE");
    }
    // Docker DNS keeps the container name stable across IP changes and avoids
    // repeating two daemon inspections on every Agent API request.
    return { hostname: containerName, port: 8642, protocol: "http:" };
  }

  const controlPlaneError: any = controlPlaneResult.reason;
  if (controlPlaneError?.statusCode !== 404) throw controlPlaneError;
  // Development process running directly on the host: preserve the existing
  // bridge-address fallback because Docker DNS is unavailable there.
  return { hostname: address, port: 8642, protocol: "http:" };
}

export async function resolveLocalInstanceTarget(instanceId: string): Promise<LocalInstanceTarget> {
  const cached = targetCache.get(instanceId);
  if (cached && cached.expiresAt > Date.now()) return cached.target;
  targetCache.delete(instanceId);

  const pending = targetResolutions.get(instanceId);
  if (pending) return pending;

  const resolution = inspectLocalInstanceTarget(instanceId)
    .then(target => {
      targetCache.set(instanceId, {
        target,
        expiresAt: Date.now() + LOCAL_INSTANCE_TARGET_TTL_MS,
      });
      return target;
    })
    .finally(() => targetResolutions.delete(instanceId));
  targetResolutions.set(instanceId, resolution);
  return resolution;
}
