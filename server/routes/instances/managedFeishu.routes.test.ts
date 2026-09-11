import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
vi.hoisted(() => { process.env.ENCRYPTION_KEY = "b".repeat(64); });
vi.mock("../../middlewares/auth", () => ({ authenticateToken: (req: any, res: any, next: any) => {
  if (!req.headers["test-user"]) return res.sendStatus(401);
  req.user = { id: req.headers["test-user"], role: "user" }; next();
} }));
vi.mock("../../services/channels/managedFeishuWorker", () => ({ managedFeishuStatus: () => "disabled" }));
import { createManagedFeishuRoutes } from "./managedFeishu.routes";
import { mutateStoreCollections, readStoreCollections } from "../../localStore";
import { decrypt } from "../../crypto";

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use(createManagedFeishuRoutes());
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("TEST_ADDRESS");
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
beforeEach(() => mutateStoreCollections(["instances"], data => {
  data.instances = ["pi", "codex"].map(id => ({ id, user_id: "owner", runtime_type: id, config_json: "{}" }));
}));
const put = (id = "pi", user = "owner", extra = {}) => fetch(`${base}/${id}/managed-feishu`, { method: "PUT", headers: { "Content-Type": "application/json", "test-user": user }, body: JSON.stringify({ enabled: true, appId: "cli_test", appSecret: "test-only-secret", allowedUsers: "ou_test", ...extra }) });

describe("managed Feishu configuration API", () => {
  it("requires authentication and instance ownership", async () => {
    expect((await fetch(`${base}/pi/managed-feishu`)).status).toBe(401);
    expect((await put("pi", "other")).status).toBe(403);
  });
  it("encrypts secrets and never includes them in the API response", async () => {
    const response = await put(); expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.configuration.hasSecret).toBe(true);
    expect(JSON.stringify(body)).not.toContain("test-only-secret");
    const config = JSON.parse(readStoreCollections(["instances"]).instances[0].config_json);
    expect(config.feishuAppSecret).not.toBe("test-only-secret");
    expect(decrypt(config.feishuAppSecret)).toBe("test-only-secret");
  });
  it("rejects duplicate app bindings and preserves the second instance", async () => {
    expect((await put()).status).toBe(200);
    const duplicate = await put("codex");
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error).toBe("FEISHU_APP_ALREADY_BOUND");
    expect(readStoreCollections(["instances"]).instances[1].config_json).toBe("{}");
  });
  it("requires explicit user allowlisting and a new secret when changing apps", async () => {
    expect((await put("pi", "owner", { allowedUsers: "" })).status).toBe(409);
    expect((await put()).status).toBe(200);
    expect((await put("pi", "owner", { appId: "cli_other", appSecret: "" })).status).toBe(409);
  });
  it("does not compete with an existing Hermes Feishu bot", async () => {
    mutateStoreCollections(["instances"], data => { data.instances.push({ id: "hermes", runtime_type: "hermes", user_id: "owner", config_json: JSON.stringify({ channel: "feishu", feishuAppId: "cli_test" }) }); });
    const response = await put();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("FEISHU_APP_ALREADY_BOUND");
  });
});
