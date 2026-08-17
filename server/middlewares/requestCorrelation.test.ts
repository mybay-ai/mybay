import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ErrorCodes } from "../../shared/errorCodes";
import { sendApiError } from "../utils/apiErrorResponse";
import { REQUEST_ID_PATTERN, requestCorrelation } from "./requestCorrelation";

describe("request correlation middleware", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(requestCorrelation);
    app.get("/ok", (_req, res) => res.json({ requestId: res.locals.requestId }));
    app.get("/error", (_req, res) => sendApiError(res, {
      status: 404,
      code: ErrorCodes.INSTANCE_NOT_FOUND,
    }));
    server = createServer(app);
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("generates a UUID and uses it in the response header and API error payload", async () => {
    const response = await fetch(`${baseUrl}/error`);
    const requestId = response.headers.get("x-request-id");
    const payload = await response.json() as { requestId?: string };
    expect(requestId).toMatch(REQUEST_ID_PATTERN);
    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(payload.requestId).toBe(requestId);
  });

  it("preserves a valid incoming request ID", async () => {
    const response = await fetch(`${baseUrl}/error`, { headers: { "X-Request-Id": "client.req-123:abc" } });
    expect(response.headers.get("x-request-id")).toBe("client.req-123:abc");
    expect((await response.json() as { requestId?: string }).requestId).toBe("client.req-123:abc");
  });

  it("replaces an invalid incoming request ID", async () => {
    const response = await fetch(`${baseUrl}/ok`, { headers: { "X-Request-Id": "invalid request id!" } });
    const requestId = response.headers.get("x-request-id");
    expect(requestId).toMatch(REQUEST_ID_PATTERN);
    expect(requestId).not.toBe("invalid request id!");
    expect((await response.json() as { requestId?: string }).requestId).toBe(requestId);
  });

  it("generates different IDs for separate requests", async () => {
    const [first, second] = await Promise.all([fetch(`${baseUrl}/ok`), fetch(`${baseUrl}/ok`)]);
    expect(first.headers.get("x-request-id")).not.toBe(second.headers.get("x-request-id"));
  });
});
