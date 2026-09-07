import express from "express";
import { expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ activities: [] as any[] }));
vi.mock("../../db", () => ({ dbAdapter: {
  getInstanceById: async () => ({ id: "agent", user_id: "owner", config_json: "{}" }),
  getInstances: async () => [],
} }));
vi.mock("../../middlewares/auth", () => ({ authenticateToken: (req: any, res: any, next: any) => {
  if (!req.headers["x-test-user"]) return res.sendStatus(401);
  req.user = { id: req.headers["x-test-user"], role: "user" }; next();
} }));
vi.mock("../../localStore", () => ({ readStoreCollections: () => ({ chatRuns: [], a2aTaskLinks: [] }) }));
vi.mock("../../services/a2aActivity", () => ({
  readA2AActivities: () => fixture.activities,
  mergeA2ATaskLinkActivities: (activities: any[]) => activities,
  applyA2ARemoteTaskEvidence: (activity: any) => activity,
  groupA2AOrchestrations: () => [],
}));
import { createA2ARoutes } from "./a2a.routes";

it("filters the room before limiting, excludes inbound records, reports truncation, and preserves authorization", async () => {
  const row = (i: number, contextId = "ctx-mybay-room-current") => ({ taskId: `task-${i}`, contextId, peerId: "peer", direction: "outbound", startedAt: String(i), status: "completed" });
  fixture.activities = [...Array.from({ length: 60 }, (_, i) => row(i, "ctx-other")), row(61), { ...row(62), direction: "inbound" }];
  const app = express(); app.use(createA2ARoutes());
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}/agent/a2a/activity`;
  const get = (query: string, user = "owner") => fetch(`${url}?${query}`, { headers: { "x-test-user": user } });
  try {
    const query = "limit=50&roomContextId=ctx-mybay-room-current";
    expect((await fetch(`${url}?${query}`)).status).toBe(401);
    expect((await get(query, "other")).status).toBe(403);
    expect((await get("roomContextId=../invalid")).status).toBe(400);
    expect(await (await get(query)).json()).toMatchObject({ activities: [row(61)], totalActivities: 1, activitiesTruncated: false });
    fixture.activities = Array.from({ length: 51 }, (_, i) => row(i));
    const result = await (await get(query)).json();
    expect(result.activities).toHaveLength(50);
    expect(result).toMatchObject({ totalActivities: 51, activitiesTruncated: true });
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
