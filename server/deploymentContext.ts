import path from "path";
import { buildInstancePublicUrl, normalizeBaseDomain, getInstanceRootDomain } from "./utils/publicUrl";

export interface DeploymentContext {
  instanceId: string;
  slug: string;
  baseDomain: string;
  subdomain: string;
  publicUrl: string;
  enableDashboard: boolean;
  
  // Single port architecture properties
  internal_web_port: number; // Defaults to 9119
  host_port?: number;        // Unique host port assigned for the instance (or undefined if purely using Traefik container network)
  containerName: string;
  internalWebPort: number;
  hostPort?: number;

  // Legacy fields (deprecated)
  gatewayHostPort: number;
  dashboardHostPort: number;
  gatewayContainerName: string;
  dashboardContainerName: string; // This represents the single unified MyBay container
  networkName: string;
  nginxConfigFileName: string;
  nginxConfigContainerPath: string;
}

export function buildDeploymentContext(instance: any, config?: any): DeploymentContext {
  const instanceId = String(instance?.id || config?.id || "");
  const slug = instance?.path || config?.path || "";
  const baseDomain = getInstanceRootDomain();
  const subdomain = `${slug}.${baseDomain}`;

  let resolvedConfig = config;
  if (!resolvedConfig && instance?.config_json) {
    try {
      resolvedConfig = JSON.parse(instance.config_json);
    } catch (e) {
      resolvedConfig = {};
    }
  }

  // Handle new single-port model fields
  const internal_web_port = parseInt(resolvedConfig?.internal_web_port || "9119", 10);
  
  // host_port can be obtained from either new 'host_port' field or legacy 'port' field
  let host_port: number | undefined;
  if (resolvedConfig?.host_port) {
    host_port = parseInt(String(resolvedConfig.host_port), 10);
  } else if (resolvedConfig?.port) {
    host_port = parseInt(String(resolvedConfig.port), 10);
  }

  const publicUrl = buildInstancePublicUrl(slug, host_port, {
    mode: resolvedConfig?.deployment_mode,
    host: resolvedConfig?.instance_access_host,
  });

  // Maintain backward compatibility fields (deprecated)
  const containerName = `mybay-agent-${instanceId}`;
  const internalWebPort = internal_web_port;
  const hostPort = host_port;

  const gatewayHostPort = host_port || 15929;
  const dashboardHostPort = host_port || 15929; // Use the same single port for unified architecture compatibility

  const gatewayContainerName = containerName;
  const dashboardContainerName = containerName;
  const networkName = `mybay-net-${instanceId}`;
  const nginxConfigFileName = `mybay-agent-${instanceId}.conf`;
  const nginxConfigContainerPath = path.join(process.cwd(), "data", "nginx", nginxConfigFileName);

  return {
    instanceId,
    slug,
    baseDomain,
    subdomain,
    publicUrl,
    enableDashboard: resolvedConfig?.enableDashboard ?? true,
    internal_web_port,
    host_port,
    containerName,
    internalWebPort,
    hostPort,
    gatewayHostPort,
    dashboardHostPort,
    gatewayContainerName,
    dashboardContainerName,
    networkName,
    nginxConfigFileName,
    nginxConfigContainerPath,
  };
}

/**
 * Secures container lookup by validating that target physical container IDs/names
 * strictly map to the expected naming scheme for the given instance.
 */
export async function getValidatedContainer(docker: any, instance: any): Promise<any> {
  const instanceId = String(instance.id);
  const ctx = buildDeploymentContext(instance);
  const expectedName = ctx.dashboardContainerName; // "mybay-agent-${instanceId}"

  // Whitelist of valid prefixes/names for this instance
  const expectedPrefixes = [
    `mybay-agent-${instanceId}-gateway`,
    `mybay-agent-${instanceId}-dashboard`,
    `mybay-agent-${instanceId}-old`,
    `mybay-agent-${instanceId}-recreate`,
    `mybay-agent-${instanceId}`
  ];

  const validateName = (name: string): boolean => {
    if (!name) return false;
    const clean = name.startsWith('/') ? name.substring(1) : name;
    return expectedPrefixes.some(p => clean === p || clean.startsWith(p + "-"));
  };

  // 1. If we have a container_id, inspect it to verify its name belongs to the instance
  if (instance.container_id) {
    try {
      const container = docker.getContainer(instance.container_id);
      const inspectData = await container.inspect();
      if (validateName(inspectData.Name)) {
        return container;
      }
      console.warn(`[Container Validation] container_id ${instance.container_id} name ${inspectData.Name} does not belong to instance ${instanceId}`);
    } catch (err: any) {
      console.warn(`[Container Validation] failed to inspect container_id ${instance.container_id}:`, err.message);
    }
  }

  // 2. If we have a container_name, verify it matches our prefix rules
  if (instance.container_name && validateName(instance.container_name)) {
    return docker.getContainer(instance.container_name);
  }

  // 3. Fallback to construction name (expected name)
  return docker.getContainer(expectedName);
}

