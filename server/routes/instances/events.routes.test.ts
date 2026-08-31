import express from "express";
import packageJson from "../../../package.json";
import { describe, expect, it, vi } from "vitest";
const getInstanceById = vi.hoisted(() => vi.fn());
vi.mock("../../db", () => ({ dbAdapter: { getInstanceById } }));
vi.mock("../../middlewares/auth", () => ({ authenticateToken: (req: any, res: any, next: any) => {
  if (!req.headers["x-test-user"]) return res.status(401).json({ error: "UNAUTHORIZED" });
  req.user = { id: req.headers["x-test-user"], role: "user" }; next();
} }));
vi.mock("../../deploymentContext", () => ({ buildDeploymentContext: () => ({ containerName: "private-container", networkName: "private-network", internal_web_port: 80 }) }));
import { createEventsRoutes } from "./events.routes";

describe("diagnostic export boundary", () => {
  it("authorizes before Docker inspection and exports only sanitized fields without cache", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const inspect = vi.fn().mockRejectedValue(new Error("PRIVATE filesystem /home/private API_KEY=PRIVATE"));
    const getContainer = vi.fn(() => ({ inspect }));
    getInstanceById.mockResolvedValue({ id, user_id: "owner", name: "PRIVATE", status: "stopped", config_json: { password: "PRIVATE" } });
    const app = express(); app.use("/api/instances", createEventsRoutes({ docker: { getContainer } as any }));
    const server = app.listen(0);
    try {
      await new Promise<void>(resolve => server.once("listening", resolve));
      const url = `http://127.0.0.1:${(server.address() as any).port}/api/instances/${id}/diagnostics`;
      expect((await fetch(url)).status).toBe(401);
      expect((await fetch(url, { headers: { "x-test-user": "other" } })).status).toBe(403);
      expect(getContainer).not.toHaveBeenCalled();
      const response = await fetch(url, { headers: { "x-test-user": "owner" } });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const payload = await response.json();
      expect(payload.shareableReport.instanceId).toBe(id);
      expect(payload.shareableReport.applicationVersion).toBe(packageJson.version);
      expect(JSON.stringify(payload.shareableReport)).not.toContain("PRIVATE");
      expect(inspect).toHaveBeenCalledTimes(1);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
