import express from "express";
import { describe, expect, it, vi } from "vitest";
const place = vi.hoisted(() => vi.fn(async () => []));
vi.mock("../../../repositories/chatRepo", () => ({ chatRepo: { placeConversation: place } }));
vi.mock("../../../middlewares/auth", () => ({ authenticateToken: (req: any, res: any, next: any) => {
  const user = req.headers["x-test-user"];
  if (!user) return res.status(401).json({ success: false });
  req.user = { id: user }; next();
} }));
vi.mock("../../../services/instances/resourceAuthorityService", () => ({
  resolveInstanceAuthority: async ({ actor }: any) => actor.id === "owner" ? { ok: true } : { ok: false, status: 403, code: "FORBIDDEN" },
}));
import { registerConversationRoutes } from "./conversation.routes";

describe("conversation placement HTTP boundary", () => {
  it("requires authentication, ownership and valid placement fields", async () => {
    const router = express.Router(); registerConversationRoutes(router);
    const app = express(); app.use(express.json()); app.use(router);
    const server = app.listen(0);
    try {
      await new Promise<void>(resolve => server.once("listening", resolve));
      const url = `http://127.0.0.1:${(server.address() as any).port}/agent/conversations/placement`;
      const body = { conversationId: "11111111-1111-4111-8111-111111111111", targetId: null, section: { kind: "recent" }, position: "after" };
      const send = (user: string, value: unknown) => fetch(url, { method: "PUT", headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) }, body: JSON.stringify(value) });
      expect((await send("", body)).status).toBe(401);
      expect((await send("other", body)).status).toBe(403);
      for (const bad of [{ ...body, targetId: "bad" }, { ...body, section: { kind: "project" } }, { ...body, position: "inside" }, { ...body, section: { kind: "unknown" } }]) {
        expect((await send("owner", bad)).status).toBe(400);
      }
      expect(place).not.toHaveBeenCalled();
      expect((await send("owner", body)).status).toBe(200);
      expect(place).toHaveBeenCalledWith("owner", "agent", body);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
