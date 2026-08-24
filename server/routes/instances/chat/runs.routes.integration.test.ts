import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

const instanceId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";

const getInstanceById = vi.hoisted(() => vi.fn());
const beginChatRun = vi.hoisted(() => vi.fn());
const probeCapabilities = vi.hoisted(() => vi.fn());
const probeCapabilitiesDetailed = vi.hoisted(() => vi.fn());
const requestRunsReconcile = vi.hoisted(() => vi.fn());

vi.mock("../../../middlewares/auth", () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { id: userId, role: "admin" };
    next();
  }
}));
vi.mock("../../../db", () => ({ dbAdapter: { getInstanceById } }));
vi.mock("../../../repositories/chatRepo", () => ({
  chatRepo: {
    beginChatRun,
    updateChatMessageMetadata: vi.fn(),
    finishChatRun: vi.fn(),
    getChatRun: vi.fn(),
    requestStopChatRun: vi.fn()
  }
}));
vi.mock("../../../utils/capabilities", () => ({ probeCapabilities, probeCapabilitiesDetailed }));
vi.mock("../../../services/runsReconciler", () => ({ emitRunLifecycleStep: vi.fn(), requestRunsAPI: vi.fn(), requestRunsReconcile }));
vi.mock("../../../services/chatRealtime", () => ({ emitChatConversationUpdated: vi.fn() }));
vi.mock("./limiters", () => ({ runsLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock("../../../utils/chatAttachments", () => ({ loadAndValidateChatAttachments: vi.fn().mockResolvedValue([]) }));
vi.mock("../../../utils/managedOperationGuard", () => ({ guardManagedOperation: () => ({ blocked: false }) }));

import { registerRunRoutes } from "./runs.routes";

describe("Interactive Agent POST /runs integration", () => {
  afterEach(() => {
    delete process.env.MYBAY_ASYNC_CHAT_RUNS_ENABLED;
    vi.clearAllMocks();
  });

  it("creates a queued Run when the gate is enabled and Hermes supports Runs", async () => {
    process.env.MYBAY_ASYNC_CHAT_RUNS_ENABLED = "true";
    getInstanceById.mockResolvedValue({ id: instanceId, user_id: userId, owner_id: userId, config_json: "{}" });
    probeCapabilities.mockResolvedValue("supported");
    probeCapabilitiesDetailed.mockResolvedValue({
      state: "supported",
      runsSupported: true,
      toolProgressEvents: true,
      features: { run_submission: true, run_status: true }
    });
    beginChatRun.mockResolvedValue({
      status: "success",
      user_message_id: "44444444-4444-4444-8444-444444444444",
      sequence_no: 1
    });

    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerRunRoutes(router);
    app.use("/api/instances", router);
    const server = app.listen(0);

    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP port");
      const response = await fetch(`http://127.0.0.1:${address.port}/api/instances/${instanceId}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, content: "Run an interactive Agent task", requestId: "request-1", reasoningEffort: "fast" })
      });
      const body = await response.json();

      expect(response.status).toBe(202);
      expect(body).toMatchObject({ success: true, status: "queued" });
      expect(body.runId).toMatch(/^[0-9a-f-]{36}$/);
      expect(beginChatRun).toHaveBeenCalledWith(expect.objectContaining({
        instanceId,
        conversationId,
        userId,
        requestId: "request-1",
        reasoningEffort: "fast"
      }));
      expect(requestRunsReconcile).toHaveBeenCalledOnce();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("returns the original Run when a lost create response is retried with the same request", async () => {
    process.env.MYBAY_ASYNC_CHAT_RUNS_ENABLED = "true";
    getInstanceById.mockResolvedValue({ id: instanceId, user_id: userId, owner_id: userId, config_json: "{}" });
    probeCapabilities.mockResolvedValue("supported");
    beginChatRun.mockResolvedValue({
      status: "IDEMPOTENT_REPLAY",
      user_message_id: "44444444-4444-4444-8444-444444444444",
      sequence_no: 1,
      run_id: "55555555-5555-4555-8555-555555555555",
      run_status: "running"
    });

    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerRunRoutes(router);
    app.use("/api/instances", router);
    const server = app.listen(0);

    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP port");
      const response = await fetch(`http://127.0.0.1:${address.port}/api/instances/${instanceId}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, content: "Run an interactive Agent task", requestId: "request-1" })
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual(expect.objectContaining({
        success: true,
        replayed: true,
        runId: "55555555-5555-4555-8555-555555555555",
        status: "running"
      }));
      expect(requestRunsReconcile).toHaveBeenCalledOnce();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
