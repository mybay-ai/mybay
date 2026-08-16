import { describe, it, expect, vi } from "vitest";
import { parseTraefikEnv, generateTraefikLabels, getTraefikRouterName, getTraefikHostRule, getTraefikAuthMiddlewareName } from "./traefikConfig";

vi.mock("../../crypto", () => ({
  tryResolvePlainInstancePassword: (config: any) => {
    if (config?.webPasswordHash) {
      return "mock-plain-password";
    }
    return null;
  }
}));

describe("Traefik Pure Configuration Module", () => {
  describe("parseTraefikEnv", () => {
    it("should parse default env correctly", () => {
      const config = parseTraefikEnv({});
      expect(config.proxyMode).toBe("local");
      expect(config.isTraefik).toBe(false);
      expect(config.isLocal).toBe(true);
      expect(config.traefikNetwork).toBe("traefik_proxy");
      expect(config.traefikContainerName).toBe("traefik");
      expect(config.traefikInternalUrl).toBe("http://traefik/");
    });

    it("should parse Traefik mode and custom values", () => {
      const env = {
        PROXY_MODE: "traefik",
        TRAEFIK_NETWORK: "my_proxy_net",
        TRAEFIK_CONTAINER_NAME: "my_traefik",
        TRAEFIK_INTERNAL_URL: "http://my_traefik:80/"
      };
      const config = parseTraefikEnv(env);
      expect(config.proxyMode).toBe("traefik");
      expect(config.isTraefik).toBe(true);
      expect(config.traefikNetwork).toBe("my_proxy_net");
      expect(config.traefikContainerName).toBe("my_traefik");
      expect(config.traefikInternalUrl).toBe("http://my_traefik:80/");
    });
  });

  describe("Name generators", () => {
    it("should get correct router name", () => {
      expect(getTraefikRouterName("test-123")).toBe("hermes-test-123");
    });
    
    it("should get correct host rule for non-admin", () => {
      expect(getTraefikHostRule("test.example.com")).toBe("Host(`test.example.com`) && !PathPrefix(`/api/files`) && !PathPrefix(`/files`) && !PathPrefix(`/workspace`)");
      expect(getTraefikHostRule("test.example.com", "user")).toBe("Host(`test.example.com`) && !PathPrefix(`/api/files`) && !PathPrefix(`/files`) && !PathPrefix(`/workspace`)");
    });
    
    it("should get correct host rule for admin", () => {
      expect(getTraefikHostRule("test.example.com", "admin")).toBe("Host(`test.example.com`)");
      expect(getTraefikHostRule("test.example.com", "super_admin")).toBe("Host(`test.example.com`)");
    });

    it("should get correct auth middleware name", () => {
      expect(getTraefikAuthMiddlewareName("my-router")).toBe("my-router-auth");
    });
  });

  describe("generateTraefikLabels", () => {
    it("should explicitly set service for public router", () => {
      const labels = generateTraefikLabels("inst-service-test", "test.com", { enableDashboard: false } as any, "proxy_net");
      const publicRouterName = "hermes-inst-service-test-public";
      expect(labels[`traefik.http.routers.${publicRouterName}.service`]).toBe("hermes-inst-service-test");
    });

    it("should generate labels without auth and default port", () => {
      const labels = generateTraefikLabels("inst-1", "app.test.com", { enableDashboard: false }, "my_net");
      expect(labels["traefik.enable"]).toBe("true");
      expect(labels["traefik.docker.network"]).toBe("my_net");
      expect(labels["traefik.http.routers.hermes-inst-1-mybay.rule"]).toBe("Host(`app.test.com`) && PathPrefix(`/__mybay/session-complete`)");
      expect(labels["traefik.http.routers.hermes-inst-1-mybay.service"]).toBe("mybay-console-service@file");
      expect(labels["traefik.http.routers.hermes-inst-1-mybay.priority"]).toBe("9999");
      expect(labels["traefik.http.routers.hermes-inst-1-mybay.middlewares"]).toBeUndefined();
    });

    it("should explicitly set service for normal router", () => {
      process.env.CONTROL_PLANE_INTERNAL_URL = "http://mybay-console:15928";
      const labels = generateTraefikLabels("inst-service-test2", "test2.com", { enableDashboard: true, webPasswordHash: "mocked" } as any, "proxy_net");
      const routerName = "hermes-inst-service-test2";
      expect(labels[`traefik.http.routers.${routerName}.service`]).toBe(routerName);
    });

    it("should generate labels with session forward auth and custom port", () => {
      process.env.CONTROL_PLANE_INTERNAL_URL = "http://hermes-saas-console:15928";
      const config = {
        internal_web_port: 8080,
        username: "admin",
        webPasswordHash: "hash123"
      };
      const labels = generateTraefikLabels("inst-2", "auth.test.com", config, "proxy_net");
      expect(labels["traefik.enable"]).toBe("true");
      expect(labels["traefik.docker.network"]).toBe("proxy_net");
      expect(labels["traverik.http.routers.hermes-inst-2-mybay.rule"]).toBeUndefined(); // we now check exact labels
      expect(labels["traefik.http.routers.hermes-inst-2.middlewares"]).toBe("hermes-inst-2-auth,hermes-inst-2-headers");
      expect(labels["traefik.http.middlewares.hermes-inst-2-auth.forwardauth.address"]).toBe(`http://hermes-saas-console:15928/api/public/instances/auth-check`);
    });

    it("should not generate public /v1 router for non-API channels", () => {
      const labels = generateTraefikLabels("inst-3", "app.test.com", { channel: "slack", enableDashboard: false } as any, "my_net");
      expect(labels["traefik.http.routers.hermes-inst-3-api.rule"]).toBeUndefined();
      expect(labels["traefik.http.routers.hermes-inst-3-api-secure.rule"]).toBeUndefined();
    });

    it("should generate public /v1 router for API channel", () => {
      const labels = generateTraefikLabels("inst-3", "app.test.com", { channel: "api", enableDashboard: false } as any, "my_net");
      expect(labels["traefik.http.routers.hermes-inst-3-api.rule"]).toBe("Host(`app.test.com`) && PathPrefix(`/v1`)");
      expect(labels["traefik.http.routers.hermes-inst-3-api-secure.rule"]).toBe("Host(`app.test.com`) && PathPrefix(`/v1`)");
    });

    it("should not put webhook paths in public whitelist if webhook is disabled", () => {
      const labels = generateTraefikLabels("inst-5", "app.test.com", { channel: "api", enableDashboard: false } as any, "my_net");
      const bypassRule = labels["traefik.http.routers.hermes-inst-5-public.rule"];
      expect(bypassRule).not.toContain("PathPrefix(`/webhook`)");
      expect(bypassRule).not.toContain("PathPrefix(`/webhooks`)");
    });

    it("should generate internal-api route with correct host, rule and headers when MYBAY_INTERNAL_ROUTING_SECRET is set", () => {
      process.env.MYBAY_INTERNAL_ROUTING_SECRET = "test-secret-123";
      const labels = generateTraefikLabels("inst-4", "app.test.com", { enableDashboard: false }, "my_net");
      const rule = labels["traefik.http.routers.hermes-inst-4-internal-api.rule"];
      expect(rule).toBe("Host(`mybay-internal-api-inst-4.internal`) && PathPrefix(`/v1`) && Header(`X-MyBay-Internal-Routing`, `test-secret-123`)");
      expect(labels["traefik.http.routers.hermes-inst-4-internal-api.service"]).toBe("hermes-inst-4-api");
    });
  });
});
