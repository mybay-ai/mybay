import { docker } from "../lib/docker";

export type LocalInstanceTarget = {
  hostname: string;
  port: number;
  protocol: "http:";
};

export async function resolveLocalInstanceTarget(instanceId: string): Promise<LocalInstanceTarget> {
  const containerName = `mybay-agent-${instanceId}`;
  const inspect = await docker.getContainer(containerName).inspect();
  const networks = inspect.NetworkSettings?.Networks || {};
  const networkName = "mybay-net-" + instanceId;
  const preferred = networks[networkName];
  const address = preferred?.IPAddress || Object.values(networks).find((item: any) => item?.IPAddress)?.IPAddress;
  if (!address) throw new Error("LOCAL_INSTANCE_NETWORK_UNAVAILABLE");

  // Self-heal installations upgraded from the old proxy-only local mode.
  const controlPlaneName = process.env.MYBAY_CONTROL_PANEL_CONTAINER || "mybay-local-control-panel";
  try {
    const controlPlane = docker.getContainer(controlPlaneName);
    const controlInspect = await controlPlane.inspect();
    if (!controlInspect.NetworkSettings?.Networks?.[networkName]) {
      await docker.getNetwork(networkName).connect({ Container: controlPlane.id });
    }
  } catch (err: any) {
    const canRunFromHost = err?.statusCode === 404;
    const alreadyConnected = err?.statusCode === 409 || String(err?.message || "").toLowerCase().includes("already exists");
    if (!canRunFromHost && !alreadyConnected) throw err;
  }
  return { hostname: address, port: 8642, protocol: "http:" };
}
