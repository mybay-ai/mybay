import { generateTraefikLabels } from "../infrastructure/traefik/traefikConfig";

export function getTraefikLabels(
  instanceId: string,
  subdomain: string,
  config: any,
  network: string,
  userRole?: string
): Record<string, string> {
  return generateTraefikLabels(instanceId, subdomain, config, network, userRole);
}