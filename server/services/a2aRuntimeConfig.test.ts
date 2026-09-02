import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ dbAdapter: { getInstanceById: vi.fn() } }));
vi.mock("../crypto", () => ({
  encrypt: (value: string) => `encrypted:${value}`,
  decrypt: (value: string) => value.replace(/^encrypted:/, ""),
}));

import { buildA2ARuntimeEnv, buildA2AYamlConfig, ensureA2ABearerToken } from "./a2aRuntimeConfig";

describe("A2A runtime configuration", () => {
  it("generates and reuses an encrypted bearer token", () => {
    const config: any = {};
    expect(ensureA2ABearerToken(config).generated).toBe(true);
    expect(config.a2aBearerToken).toMatch(/^encrypted:mb_a2a_/);
    expect(ensureA2ABearerToken(config).generated).toBe(false);
  });

  it("binds A2A to the private container network with safety limits", () => {
    expect(buildA2ARuntimeEnv({
      a2aEnabled: true,
      a2aBearerToken: "encrypted:secret",
      a2aAgentName: "Research Agent",
      instanceId: "research",
      a2aRateLimit: 9999,
      a2aMaxPingPongTurns: 999,
    })).toMatchObject({
      A2A_BEARER_TOKEN: "secret",
      A2A_HOST: "0.0.0.0",
      A2A_PORT: "9900",
      A2A_PUBLIC_URL: "http://mybay-agent-research:9900",
      A2A_RATE_LIMIT: "600",
      A2A_MAX_PINGPONG_TURNS: "20",
    });
  });

  it("writes only resolved peers into Hermes YAML", () => {
    const result = buildA2AYamlConfig({
      a2aEnabled: true,
      a2aResolvedPeers: [{ instanceId: "peer-1", url: "http://peer:9900", encryptedToken: "encrypted:peer-token", capabilities: ["research", "review"] }],
    });
    expect(result).toMatchObject({
      gateway: { platforms: { a2a: { enabled: true, extra: { port: 9900 } } } },
      a2a_agents: { "peer-1": { auth: { type: "bearer", token: "peer-token" }, capabilities: ["research", "review"] } },
    });
  });
});
