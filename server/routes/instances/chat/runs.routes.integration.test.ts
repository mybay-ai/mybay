import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

const instanceId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";

const getInstanceById = vi.hoisted(() => vi.fn());
const getInstances = vi.hoisted(() => vi.fn());
const beginChatRun = vi.hoisted(() => vi.fn());
const getChatRun = vi.hoisted(() => vi.fn());
const getConversationForOwnerAndInstance = vi.hoisted(() => vi.fn());
const requestStopChatRun = vi.hoisted(() => vi.fn());
const releaseRunLease = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const probeCapabilities = vi.hoisted(() => vi.fn());
const probeCapabilitiesDetailed = vi.hoisted(() => vi.fn());
const requestRunsReconcile = vi.hoisted(() => vi.fn());
const requestRunReconcile = vi.hoisted(() => vi.fn(() => true));
const primeRunFileSnapshot = vi.hoisted(() => vi.fn());
const discardRunFileSnapshot = vi.hoisted(() => vi.fn());
const isQuestionBridgeInstalling = vi.hoisted(() => vi.fn(() => false));
vi.mock("../../../services/runs/questionBridgeInstaller", () => ({ isQuestionBridgeInstalling }));

vi.mock("../../../middlewares/auth", () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { id: userId, role: "admin" };
    next();
  }
}));
vi.mock("../../../db", () => ({ dbAdapter: { getInstanceById, getInstances } }));
vi.mock("../../../repositories/chatRepo", () => ({
  chatRepo: {
    beginChatRun,
    updateChatMessageMetadata: vi.fn(),
    finishChatRun: vi.fn(),
    getChatRun,
    getConversationForOwnerAndInstance,
    requestStopChatRun,
    releaseRunLease,
  }
}));
vi.mock("../../../utils/capabilities", () => ({ probeCapabilities, probeCapabilitiesDetailed }));
vi.mock("../../../services/runsReconciler", () => ({
  discardRunFileSnapshot,
  emitRunLifecycleStep: vi.fn(),
  primeRunFileSnapshot,
  RECONCILER_ID: "reconciler-route-test",
  requestRunsAPI: vi.fn(),
  requestRunReconcile,
  requestRunsReconcile,
}));
vi.mock("../../../services/chatRealtime", () => ({ emitChatConversationUpdated: vi.fn() }));
vi.mock("./limiters", () => ({ runsLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock("../../../utils/chatAttachments", () => ({ loadAndValidateChatAttachments: vi.fn().mockResolvedValue([]) }));
vi.mock("../../../utils/managedOperationGuard", () => ({ guardManagedOperation: () => ({ blocked: false }) }));

import { registerRunRoutes } from "./runs.routes";

describe("Interactive Agent POST /runs integration", () => {
  it("rechecks plugin installation after awaited validation before committing a new Run", async () => {
    process.env.MYBAY_ASYNC_CHAT_RUNS_ENABLED = "true";
    getInstanceById.mockResolvedValue({ id: instanceId, user_id: userId, owner_id: userId, config_json: "{}" });
    getConversationForOwnerAndInstance.mockResolvedValue({ id: conversationId, user_id: userId, instance_id: instanceId });
    probeCapabilities.mockResolvedValue("supported");
    isQuestionBridgeInstalling.mockReturnValueOnce(false).mockReturnValueOnce(true);
    const app = express(); app.use(express.json());
    const router = express.Router(); registerRunRoutes(router); app.use("/api/instances", router);
    const server = app.listen(0);
    try {
      await new Promise<void>(resolve => server.once("listening", resolve));
      const url = `http://127.0.0.1:${(server.address() as any).port}/api/instances/${instanceId}/runs`;
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId, content: "test", requestId: "install-race" }) });
      expect(response.status).toBe(409);
      expect((await response.json()).error).toBe("INSTANCE_BUSY");
      expect(isQuestionBridgeInstalling).toHaveBeenCalledTimes(2);
      expect(beginChatRun).not.toHaveBeenCalled();
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it("serves only owned, conversation-bound stored file snapshots without caching or run DTO leakage", async () => {
    const runId = "44444444-4444-4444-8444-444444444444";
    getInstanceById.mockResolvedValue({ id: instanceId, user_id: userId, owner_id: userId });
    getConversationForOwnerAndInstance.mockResolvedValue({ id: conversationId, user_id: userId, instance_id: instanceId });
    const run = { id: runId, user_id: userId, instance_id: instanceId, conversation_id: conversationId, status: "completed", file_diffs: {
      version: 1, runId, conversationId, capturedBefore: "2026-08-31T00:00:00Z", capturedAfter: "2026-08-31T00:00:01Z", files: [{ path: "a.txt", before: "BEFORE", after: "AFTER" }],
    } };
    getChatRun.mockResolvedValue(run);
    const app = express();
    const router = express.Router(); registerRunRoutes(router); app.use("/api/instances", router);
    const server = app.listen(0);
    try {
      await new Promise<void>(resolve => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No test port");
      const base = `http://127.0.0.1:${address.port}/api/instances/${instanceId}/runs/${runId}`;
      const url = `${base}/file-diff?path=a.txt&conversationId=${conversationId}`;
      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ available: true, file: { path: "a.txt", before: "BEFORE", after: "AFTER" } });
      expect(JSON.stringify(await (await fetch(base)).json())).not.toContain("BEFORE");
      expect((await fetch(`${base}/file-diff?path=a.txt&conversationId=${userId}`)).status).toBe(404);
      expect((await fetch(`${base}/file-diff?path=..%2Fa.txt&conversationId=${conversationId}`)).status).toBe(400);
      getChatRun.mockResolvedValue({ ...run, user_id: "someone-else" });
      expect((await fetch(url)).status).toBe(404);
      getChatRun.mockResolvedValue({ ...run, instance_id: "other-instance" });
      expect((await fetch(url)).status).toBe(404);
      getChatRun.mockResolvedValue({ ...run, file_diffs: undefined });
      expect(await (await fetch(url)).json()).toEqual({ success: true, available: false });
    } finally { server.close(); }
  });
  afterEach(() => {
    delete process.env.MYBAY_ASYNC_CHAT_RUNS_ENABLED;
    vi.clearAllMocks();
  });

  it("creates a queued Run when the gate is enabled and Hermes supports Runs", async () => {
    process.env.MYBAY_ASYNC_CHAT_RUNS_ENABLED = "true";
    getInstanceById.mockResolvedValue({ id: instanceId, user_id: userId, owner_id: userId, config_json: JSON.stringify({ model: "deepseek-v4-flash" }) });
    getConversationForOwnerAndInstance.mockResolvedValue({ id: conversationId, user_id: userId, instance_id: instanceId });
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
        reasoningEffort: "fast",
        modelEvidence: { version: 1, model: "deepseek-v4-flash", source: "configured_snapshot" },
        initialLease: { reconcilerId: "reconciler-route-test", leaseSeconds: 60 },
      }));
      expect(primeRunFileSnapshot).toHaveBeenCalledWith(body.runId, instanceId);
      expect(primeRunFileSnapshot.mock.invocationCallOrder[0]).toBeLessThan(beginChatRun.mock.invocationCallOrder[0]);
      expect(discardRunFileSnapshot).not.toHaveBeenCalled();
      expect(requestRunReconcile).toHaveBeenCalledWith(body.runId);
      expect(requestRunsReconcile).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("returns the original Run when a lost create response is retried with the same request", async () => {
    process.env.MYBAY_ASYNC_CHAT_RUNS_ENABLED = "true";
    getInstanceById.mockResolvedValue({ id: instanceId, user_id: userId, owner_id: userId, config_json: "{}" });
    getConversationForOwnerAndInstance.mockResolvedValue({ id: conversationId, user_id: userId, instance_id: instanceId });
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
      expect(primeRunFileSnapshot).toHaveBeenCalledOnce();
      expect(discardRunFileSnapshot).toHaveBeenCalledWith(primeRunFileSnapshot.mock.calls[0][0]);
      expect(requestRunsReconcile).toHaveBeenCalledOnce();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("snapshots trusted collaboration-room members into the queued Run", async () => {
    process.env.MYBAY_ASYNC_CHAT_RUNS_ENABLED = "true";
    const peerId = "66666666-6666-4666-8666-666666666666";
    getInstanceById.mockResolvedValue({ id: instanceId, name: "主持", user_id: userId, owner_id: userId, config_json: JSON.stringify({ a2aEnabled: true, a2aPeerIds: [peerId] }) });
    getInstances.mockResolvedValue([{ id: peerId, name: "研究", user_id: userId, owner_id: userId, agent_image_tag: "v2026.8.27", config_json: JSON.stringify({ a2aEnabled: true }) }]);
    getConversationForOwnerAndInstance.mockResolvedValue({ id: conversationId, user_id: userId, instance_id: instanceId, collaboration: { mode: "group", peerIds: [peerId], maxRounds: 1 } });
    probeCapabilities.mockResolvedValue("supported");
    beginChatRun.mockResolvedValue({ status: "success", user_message_id: "44444444-4444-4444-8444-444444444444", sequence_no: 1 });
    const app = express(); app.use(express.json());
    const router = express.Router(); registerRunRoutes(router); app.use("/api/instances", router);
    const server = app.listen(0);
    try {
      await new Promise<void>(resolve => server.once("listening", resolve));
      const response = await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/instances/${instanceId}/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId, content: "一起研究", requestId: "group-request" }) });
      expect(response.status).toBe(202);
      expect(beginChatRun).toHaveBeenCalledWith(expect.objectContaining({
        groupCollaboration: expect.objectContaining({ mode: "group", leader: { id: instanceId, name: "主持" }, peers: [{ id: peerId, name: "研究" }], maxRounds: 1 }),
      }));
      expect(beginChatRun.mock.calls.at(-1)?.[0].groupCollaboration.contextId).toMatch(/^ctx-mybay-room-[a-f0-9]+$/);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });

  it("releases the initial lease before falling back when targeted dispatch is unavailable", async () => {
    process.env.MYBAY_ASYNC_CHAT_RUNS_ENABLED = "true";
    getInstanceById.mockResolvedValue({ id: instanceId, user_id: userId, owner_id: userId, config_json: "{}" });
    getConversationForOwnerAndInstance.mockResolvedValue({ id: conversationId, user_id: userId, instance_id: instanceId });
    probeCapabilities.mockResolvedValue("supported");
    beginChatRun.mockResolvedValue({
      status: "success",
      user_message_id: "44444444-4444-4444-8444-444444444444",
      sequence_no: 1,
    });
    requestRunReconcile.mockReturnValueOnce(false);

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
        body: JSON.stringify({ conversationId, content: "Fallback dispatch", requestId: "request-fallback" }),
      });
      const body = await response.json();

      expect(response.status).toBe(202);
      expect(releaseRunLease).toHaveBeenCalledWith({
        runId: body.runId,
        reconcilerId: "reconciler-route-test",
      });
      expect(requestRunsReconcile).toHaveBeenCalledOnce();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("wakes the reconciler immediately after a stop request is accepted", async () => {
    getInstanceById.mockResolvedValue({ id: instanceId, user_id: userId, owner_id: userId, config_json: "{}" });
    getConversationForOwnerAndInstance.mockResolvedValue({ id: conversationId, user_id: userId, instance_id: instanceId });
    getChatRun.mockResolvedValue({
      id: "55555555-5555-4555-8555-555555555555",
      instance_id: instanceId,
      user_id: userId,
      conversation_id: conversationId,
      status: "queued"
    });
    requestStopChatRun.mockResolvedValue({ status: "stop_requested", run_status: "stopping" });

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
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/instances/${instanceId}/runs/55555555-5555-4555-8555-555555555555/stop`,
        { method: "POST" }
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ success: true, status: "stopping" });
      expect(requestRunsReconcile).toHaveBeenCalledOnce();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("rejects a cross-instance conversation before creating a Run", async () => {
    process.env.MYBAY_ASYNC_CHAT_RUNS_ENABLED = "true";
    getInstanceById.mockResolvedValue({ id: instanceId, user_id: userId, owner_id: userId, config_json: "{}" });
    getConversationForOwnerAndInstance.mockResolvedValue(null);

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
        body: JSON.stringify({ conversationId, content: "unauthorized", requestId: "request-cross-parent" }),
      });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ success: false, error: "CONVERSATION_NOT_FOUND" });
      expect(beginChatRun).not.toHaveBeenCalled();
      expect(probeCapabilities).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
