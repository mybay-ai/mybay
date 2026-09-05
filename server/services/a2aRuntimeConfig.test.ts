import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ dbAdapter: { getInstanceById: vi.fn() } }));
vi.mock("../crypto", () => ({
  encrypt: (value: string) => `encrypted:${value}`,
  decrypt: (value: string) => value.replace(/^encrypted:/, ""),
}));

import { buildA2ARuntimeEnv, buildA2AYamlConfig, ensureA2ABearerToken, hydrateA2ARuntimePeers } from "./a2aRuntimeConfig";
import { dbAdapter } from '../db';

describe("A2A runtime configuration", () => {
  it('keeps direct transport by default and uses a caller-specific relay credential only when enabled', async () => {
    vi.mocked(dbAdapter.getInstanceById).mockResolvedValue({ id: 'peer', config_json: JSON.stringify({ a2aEnabled: true, a2aBearerToken: 'encrypted:peer-secret' }) } as any);
    try {
      vi.stubEnv('MYBAY_A2A_TASK_TRACKING', 'false');
      const config: any = { a2aEnabled: true, a2aPeerIds: ['peer'] };
      await hydrateA2ARuntimePeers('caller', config);
      expect(config.a2aResolvedPeers[0]).toMatchObject({ url: 'http://mybay-agent-peer:9900', encryptedToken: 'encrypted:peer-secret' });
      vi.stubEnv('MYBAY_A2A_TASK_TRACKING', 'true'); vi.stubEnv('MYBAY_INTERNAL_ROUTING_SECRET', 'test-relay-secret');
      vi.stubEnv('MYBAY_CONTROL_PANEL_CONTAINER', 'test-control');
      vi.stubEnv('MYBAY_A2A_TRACKED_INSTANCES', '');
      await hydrateA2ARuntimePeers('caller', config);
      expect(config.a2aResolvedPeers[0].url).toBe('http://mybay-agent-peer:9900');
      vi.stubEnv('MYBAY_A2A_TRACKED_INSTANCES', ' caller, another-caller ');
      await hydrateA2ARuntimePeers('caller', config);
      expect(config.a2aResolvedPeers[0].url).toBe('http://test-control:3000/internal/a2a/caller/peer');
      expect(config.a2aResolvedPeers[0].encryptedToken).not.toBe('encrypted:peer-secret');
      const first = config.a2aResolvedPeers[0].encryptedToken;
      await hydrateA2ARuntimePeers('another-caller', config);
      expect(config.a2aResolvedPeers[0].encryptedToken).not.toBe(first);
      await hydrateA2ARuntimePeers('excluded-caller', config);
      expect(config.a2aResolvedPeers[0]).toMatchObject({ url: 'http://mybay-agent-peer:9900', encryptedToken: 'encrypted:peer-secret' });
    } finally { vi.unstubAllEnvs(); }
  });
  it("carries adoption evidence even when disabling A2A without forwarding its token", () => {
    expect(buildA2ARuntimeEnv({ a2aEnabled: false, a2aRevision: "revision-2", a2aBearerToken: "encrypted:secret" }))
      .toEqual({ MYBAY_A2A_REVISION: "revision-2" });
    expect(buildA2ARuntimeEnv({ a2aEnabled: false })).toEqual({});
  });
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
