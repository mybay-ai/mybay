import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  getDeploymentTaskById: vi.fn(),
  getInstanceById: vi.fn(),
  releasePortReservation: vi.fn(),
  reservePortForInstance: vi.fn(),
  updateInstanceConfig: vi.fn(),
  updateDeploymentTask: vi.fn(),
  updateInstanceRecord: vi.fn(),
}));

vi.mock("../middlewares/auth", () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { id: "user-1", role: "admin" };
    next();
  },
}));
vi.mock("../db", () => ({ dbAdapter: state }));

import { createDeploymentsRouter } from "./deployments";

describe("deployment retry route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.getDeploymentTaskById.mockResolvedValue({
      id: "task-1", instance_id: "instance-1", status: "failed", attempt: 1, max_attempts: 3,
      payload_json: { secureData: {}, instance: { id: "instance-1" } },
    });
    state.getInstanceById.mockResolvedValue({
      id: "instance-1", user_id: "user-1", config_json: JSON.stringify({ host_port: 10100 }),
    });
    state.reservePortForInstance.mockResolvedValue(10101);
  });

  it("clears stale instance failure metadata before scheduling the retry", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/deployments", createDeploymentsRouter());
    const server = app.listen(0);
    try {
      await new Promise<void>(resolve => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No test port");
      const response = await fetch(`http://127.0.0.1:${address.port}/api/deployments/task-1/retry`, { method: "POST" });
      expect(response.status).toBe(202);
      expect(state.updateInstanceRecord).toHaveBeenCalledWith("instance-1", {
        status: "provisioning",
        desired_state: "running",
        health_status: "unknown",
        error_code: null,
        error_message: null,
        error_detail: null,
        deployment_error: null,
        failed_at: null,
        compensated_at: null,
      });
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  afterEach(() => vi.restoreAllMocks());
});
