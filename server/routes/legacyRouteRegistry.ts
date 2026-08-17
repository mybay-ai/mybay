export type LegacyRouteEntry = Readonly<{
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  replacement: string;
  removeAfter: string;
}>;

export const LEGACY_ROUTE_REGISTRY: readonly LegacyRouteEntry[] = Object.freeze([
  { method: "GET", path: "/api/template-blueprints", replacement: "/api/templates/blueprints", removeAfter: "0.3" },
  { method: "GET", path: "/api/agent-versions", replacement: "/api/mybay-versions", removeAfter: "0.3" },
  { method: "POST", path: "/api/hermes-versions/sync", replacement: "/api/mybay-versions/sync", removeAfter: "0.3" },
]);

export function findLegacyRoute(method: string, path: string): LegacyRouteEntry | undefined {
  return LEGACY_ROUTE_REGISTRY.find((entry) => entry.method === method.toUpperCase() && entry.path === path);
}
