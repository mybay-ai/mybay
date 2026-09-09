import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
const outbound = vi.hoisted(() => vi.fn());
vi.mock("../middlewares/auth", () => ({ authenticateToken: (req: any, _res: any, next: any) => { req.user = { id: "probe-user", role: "admin" }; next(); }, requireAdmin: (_req: any, _res: any, next: any) => next() }));
vi.mock("../services/system/systemNetworkPolicy", () => ({ isSafeUrl: vi.fn(async () => true), safeOutboundFetch: outbound, formatSystemRequestError: () => "network failure" }));
import router from "./systemDiagnostics.routes";
describe("Codex probe reuses model diagnostics with Responses semantics", () => {
  let server: Server; let url: string;
  beforeAll(async () => {
    const app = express(); app.use(express.json()); app.use(router);
    server = await new Promise<Server>(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    url = `http://127.0.0.1:${(server.address() as any).port}/test-llm`;
  });
  afterAll(() => server.close());
  const probe = () => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runtimeType: "codex", provider: "openai", model: "fixture", apiKey: "fixture-key" }) }).then(r => r.json());
  it("uses /responses even when the provider's generic test is chat completions", async () => {
    outbound.mockResolvedValue(new Response(JSON.stringify({ status: "completed", output: [{ type: "message" }] }), { status: 200 }));
    expect((await probe()).success).toBe(true);
    expect(outbound.mock.calls.at(-1)?.[0]).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(outbound.mock.calls.at(-1)?.[1].body)).toMatchObject({ model: "fixture", store: false });
  });
  it("rejects a successful HTTP response that is not a Responses result", async () => {
    outbound.mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    expect((await probe()).success).toBe(false);
  });
  it("normalizes saved DeepSeek chat URLs only for Codex Responses probes", async () => {
    outbound.mockResolvedValue(new Response(JSON.stringify({ status: "completed", output: [{ type: "message" }] }), { status: 200 }));
    const result = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runtimeType: "codex", provider: "deepseek", model: "deepseek-v4-flash", baseUrl: "https://api.deepseek.com/v1", apiKey: "fixture-key" }) }).then(r => r.json());
    expect(result.success).toBe(true);
    expect(outbound.mock.calls.at(-1)?.[0]).toBe("https://api.deepseek.com/responses");
  });
});
