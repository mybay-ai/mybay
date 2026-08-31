import express from "express";
import { describe, expect, it, vi } from "vitest";
const getInstanceById = vi.hoisted(() => vi.fn());
vi.mock("../../../db", () => ({ dbAdapter: { getInstanceById } }));
vi.mock("../../../middlewares/auth", () => ({ authenticateToken: (req: any, res: any, next: any) => {
  if (!req.headers["x-test-user"]) return res.status(401).json({ error: "UNAUTHORIZED" });
  req.user = { id: req.headers["x-test-user"], role: "user" }; next();
} }));
import { registerRunQuestionRoutes } from "./runQuestions.routes";
import { mutateStoreCollections } from "../../../localStore";
import { runQuestionsRepo } from "../../../repositories/runQuestionsRepo";
describe("user question authorization", () => {
  it("blocks other owners and conversations; accepts only authorized answers", async () => {
    const instanceId = "11111111-1111-4111-8111-111111111111";
    const runId = "22222222-2222-4222-8222-222222222222";
    const conversationId = "33333333-3333-4333-8333-333333333333";
    getInstanceById.mockResolvedValue({ id: instanceId, user_id: "owner" });
    mutateStoreCollections(["chatRuns", "conversations"], data => {
      data.chatRuns = [{ id: runId, instance_id: instanceId, user_id: "owner", conversation_id: conversationId, upstream_run_id: "native", runtime_type: "hermes", status: "running" }];
      data.conversations = [{ id: conversationId, instance_id: instanceId, user_id: "owner", session_id: "session" }];
    });
    runQuestionsRepo.create(instanceId, { nativeRunId: "native", sessionId: "session", id: "question", spec: { title: "Private question", options: [{ id: "a", label: "A" }], multiple: false, allowCustom: false } });
    const router = express.Router(); registerRunQuestionRoutes(router);
    const app = express(); app.use(express.json()); app.use(router);
    const server = app.listen(0);
    try {
      await new Promise<void>(resolve => server.once("listening", resolve));
      const url = `http://127.0.0.1:${(server.address() as any).port}/${instanceId}/runs/${runId}/questions`;
      expect((await fetch(`${url}?conversationId=${conversationId}`)).status).toBe(401);
      expect((await fetch(`${url}?conversationId=${conversationId}`, { headers: { "x-test-user": "other" } })).status).toBe(403);
      expect((await fetch(`${url}?conversationId=other`, { headers: { "x-test-user": "owner" } })).status).toBe(404);
      const response = await fetch(`${url}?conversationId=${conversationId}`, { headers: { "x-test-user": "owner" } });
      expect((await response.json()).questions[0].spec.title).toBe("Private question");
      const submit = (user: string, conv: string) => fetch(`${url}/question`, { method: "POST", headers: { "x-test-user": user, "content-type": "application/json" }, body: JSON.stringify({ conversationId: conv, answer: { selected: ["a"], custom: "" } }) });
      expect((await submit("other", conversationId)).status).toBe(403);
      expect((await submit("owner", "other")).status).toBe(404);
      expect((await submit("owner", conversationId)).status).toBe(200);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
