import { describe, expect, it } from "vitest";
import { findLegacyRoute, LEGACY_ROUTE_REGISTRY } from "./legacyRouteRegistry";

describe("legacy API route registry", () => {
  it("tracks every compatibility endpoint with a replacement and removal version", () => {
    expect(LEGACY_ROUTE_REGISTRY.length).toBeGreaterThan(0);
    for (const route of LEGACY_ROUTE_REGISTRY) {
      expect(route.path).toMatch(/^\/api\//);
      expect(route.replacement).toMatch(/^\/api\//);
      expect(route.removeAfter).toMatch(/^\d+\.\d+$/);
    }
  });

  it("finds routes by method and path", () => {
    expect(findLegacyRoute("get", "/api/agent-versions")?.replacement).toBe("/api/mybay-versions");
  });
});
