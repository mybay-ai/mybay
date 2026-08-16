import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { getClientIp } from "./ip";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function requestResolvedIp(trustProxy: boolean, headers: Record<string, string>) {
  const app = express();
  app.set("trust proxy", trustProxy ? 1 : false);
  app.get("/ip", (req, res) => res.json({ ip: getClientIp(req), expressIp: req.ip, ips: req.ips }));
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port");
  const response = await fetch("http://127.0.0.1:" + address.port + "/ip", { headers });
  return response.json() as Promise<{ ip: string; expressIp: string; ips: string[] }>;
}

describe("trusted proxy client IP resolution", () => {
  it.each(["1.1.1.1", "1.1.1.2", "1.1.1.3"])("ignores spoofed X-Real-IP when trust proxy is disabled: %s", async (spoofed) => {
    const result = await requestResolvedIp(false, { "X-Real-IP": spoofed });
    expect(result.ip).toBe(result.expressIp);
    expect(result.ip).not.toBe(spoofed);
  });

  it.each(["1.1.1.1", "1.1.1.2", "1.1.1.3"])("ignores spoofed CF-Connecting-IP when trust proxy is disabled: %s", async (spoofed) => {
    const result = await requestResolvedIp(false, { "CF-Connecting-IP": spoofed });
    expect(result.ip).toBe(result.expressIp);
    expect(result.ip).not.toBe(spoofed);
  });

  it("uses Express trusted X-Forwarded-For resolution when trust proxy is enabled", async () => {
    const result = await requestResolvedIp(true, { "X-Forwarded-For": "203.0.113.25" });
    expect(result.ip).toBe("203.0.113.25");
    expect(result.ips).toEqual(["203.0.113.25"]);
  });
});

async function exerciseLoginLimiter(trustProxy: boolean, headerName: string, values: string[]) {
  const app = express();
  app.set("trust proxy", trustProxy ? 1 : false);
  app.use("/login", rateLimit({
    windowMs: 60_000,
    max: 2,
    keyGenerator: (req) => `login:ip:${ipKeyGenerator(getClientIp(req))}`,
  }));
  app.post("/login", (_req, res) => res.sendStatus(204));
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port");
  const statuses: number[] = [];
  for (const value of values) {
    const response = await fetch(`http://127.0.0.1:${address.port}/login`, { method: "POST", headers: { [headerName]: value } });
    statuses.push(response.status);
  }
  return statuses;
}

describe("login rate-limit identity", () => {
  it("cannot be bypassed with rotating X-Real-IP when TRUST_PROXY=false", async () => {
    await expect(exerciseLoginLimiter(false, "X-Real-IP", ["1.1.1.1", "1.1.1.2", "1.1.1.3"])).resolves.toEqual([204, 204, 429]);
  });

  it("cannot be bypassed with rotating CF-Connecting-IP when TRUST_PROXY=false", async () => {
    await expect(exerciseLoginLimiter(false, "CF-Connecting-IP", ["1.1.1.1", "1.1.1.2", "1.1.1.3"])).resolves.toEqual([204, 204, 429]);
  });

  it("preserves Express trusted-proxy identities when TRUST_PROXY=true", async () => {
    await expect(exerciseLoginLimiter(true, "X-Forwarded-For", ["203.0.113.1", "203.0.113.2", "203.0.113.3"])).resolves.toEqual([204, 204, 204]);
  });
});