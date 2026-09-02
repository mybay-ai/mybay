import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  getInstanceById: vi.fn(),
  getInstances: vi.fn(),
  updateInstanceConfig: vi.fn(),
  insertAuditLog: vi.fn(),
  probe: vi.fn(),
}));

vi.mock("../../db", () => ({ dbAdapter: {
  getInstanceById: state.getInstanceById,
  getInstances: state.getInstances,
  updateInstanceConfig: state.updateInstanceConfig,
  insertAuditLog: state.insertAuditLog,
} }));
vi.mock("../../crypto", () => ({
  encrypt: (value: string) => `encrypted:${value}`,
  decrypt: (value: string) => value.replace(/^encrypted:/, ""),
}));
vi.mock("../../middlewares/auth", () => ({ authenticateToken: (req: any, res: any, next: any) => {
  if (!req.headers["x-test-user"]) return res.status(401).json({ code: "UNAUTHORIZED" });
  req.user = { id: req.headers["x-test-user"], role: "user" };
  next();
} }));
vi.mock("../../services/a2aProbe", () => ({ probeA2AAgentCard: state.probe }));

import { createA2ARoutes } from "./a2a.routes";

async function withServer(run: (baseUrl: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use("/api/instances", createA2ARoutes());
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as any).port}/api/instances`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("A2A instance control-plane routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.getInstanceById.mockResolvedValue({
      id: "agent-1",
      name: "Agent One",
      user_id: "owner",
      agent_image_tag: "v2026.8.31",
      config_json: JSON.stringify({}),
    });
    state.getInstances.mockResolvedValue([
      { id: "agent-1", name: "Agent One", user_id: "owner", agent_image_tag: "v2026.8.31", config_json: "{}" },
      { id: "agent-2", name: "Agent Two", user_id: "owner", agent_image_tag: "v2026.8.31", config_json: JSON.stringify({ a2aEnabled: true }) },
      { id: "deleted-agent", name: "Deleted Agent", user_id: "owner", status: "deleted", agent_image_tag: "v2026.8.31", config_json: "{}" },
    ]);
    state.probe.mockResolvedValue({ state: "ready", statusCode: 200, durationMs: 8 });
  });

  it("authorizes before returning a secret-free configuration view", async () => {
    await withServer(async (baseUrl) => {
      expect((await fetch(`${baseUrl}/agent-1/a2a`)).status).toBe(401);
      const response = await fetch(`${baseUrl}/agent-1/a2a`, { headers: { "x-test-user": "owner" } });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({ supported: true, enabled: false, port: 9900, exposure: "internal_only" });
      expect(body.peers.map((peer: any) => peer.id)).toEqual(["agent-2"]);
      expect(JSON.stringify(body)).not.toContain("BearerToken");
      expect(JSON.stringify(body)).not.toContain("mb_a2a_");
    });
  });

  it("authorizes the bounded, secret-free activity feed", async () => {
    await withServer(async (baseUrl) => {
      expect((await fetch(`${baseUrl}/agent-1/a2a/activity`)).status).toBe(401);
      const response = await fetch(`${baseUrl}/agent-1/a2a/activity?limit=500`, { headers: { "x-test-user": "owner" } });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({ activities: [], orchestrations: [] });
      expect(body.generatedAt).toEqual(expect.any(String));
      expect(JSON.stringify(body)).not.toContain("token");
    });
  });

  it("returns live status for the instance and each configured trusted peer", async () => {
    state.getInstanceById.mockResolvedValue({
      id: "agent-1",
      name: "Agent One",
      user_id: "owner",
      agent_image_tag: "v2026.8.31",
      config_json: JSON.stringify({ a2aEnabled: true, a2aPeerIds: ["agent-2"] }),
    });
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/agent-1/a2a/status`, { headers: { "x-test-user": "owner" } });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        state: "ready",
        peers: [{ id: "agent-2", state: "ready", statusCode: 200 }],
        generatedAt: expect.any(String),
      });
      expect(state.probe.mock.calls.map(([id]) => id)).toEqual(["agent-1", "agent-2"]);
    });
  });

  it("stores an encrypted token and trusted peer selection without restarting the instance", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/agent-1/a2a`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-test-user": "owner" },
        body: JSON.stringify({ enabled: true, agentName: "Research Agent", peerIds: ["agent-2"], peerCapabilities: { "agent-2": ["research", "review"] } }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ success: true, redeployRequired: true });
      const saved = JSON.parse(state.updateInstanceConfig.mock.calls[0][1]);
      expect(saved).toMatchObject({ a2aEnabled: true, a2aPeerIds: ["agent-2"], a2aPeerCapabilities: { "agent-2": ["research", "review"] }, a2aExposure: "internal_only" });
      expect(saved.a2aBearerToken).toMatch(/^encrypted:mb_a2a_/);
      expect(state.insertAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "update_a2a_config" }));
    });
  });

  it("rejects invalid or untrusted capability assignments", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/agent-1/a2a`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-test-user": "owner" },
        body: JSON.stringify({ enabled: true, agentName: "Agent One", peerIds: ["agent-2"], peerCapabilities: { "agent-2": ["bad capability!"] } }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "A2A_CAPABILITIES_INVALID" });
      expect(state.updateInstanceConfig).not.toHaveBeenCalled();
    });
  });

  it("blocks unsupported versions before changing configuration", async () => {
    state.getInstanceById.mockResolvedValue({ id: "agent-1", user_id: "owner", agent_image_tag: "v2026.7.30", config_json: "{}" });
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/agent-1/a2a`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-test-user": "owner" },
        body: JSON.stringify({ enabled: true, agentName: "Agent One", peerIds: [] }),
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "A2A_VERSION_UNSUPPORTED" });
      expect(state.updateInstanceConfig).not.toHaveBeenCalled();
    });
  });

  it("accepts owner_id ownership and keeps disabling idempotent when the name is omitted", async () => {
    state.getInstanceById.mockResolvedValue({
      id: "agent-1",
      name: "Agent One",
      owner_id: "owner",
      agent_image_tag: "v2026.8.31",
      config_json: JSON.stringify({ a2aEnabled: true, a2aAgentName: "Agent One" }),
    });
    state.getInstances.mockResolvedValue([
      { id: "agent-1", owner_id: "owner", config_json: "{}" },
      { id: "agent-2", owner_id: "owner", config_json: "{}" },
    ]);
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/agent-1/a2a`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-test-user": "owner" },
        body: JSON.stringify({ enabled: false, peerIds: [] }),
      });
      expect(response.status).toBe(200);
      const saved = JSON.parse(state.updateInstanceConfig.mock.calls[0][1]);
      expect(saved).toMatchObject({ a2aEnabled: false, a2aAgentName: "Agent One" });
    });
  });
});
