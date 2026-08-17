import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../../shared/errorCodes";

const userId = "credential-test-user";
const getCredentials = vi.hoisted(() => vi.fn());
const createCredential = vi.hoisted(() => vi.fn());
const updateCredential = vi.hoisted(() => vi.fn());
const deleteCredential = vi.hoisted(() => vi.fn());
const limiterOptions = vi.hoisted(() => ({ current: null as any }));
const getInstances = vi.hoisted(() => vi.fn());

vi.mock("../middlewares/auth", () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { id: userId, role: "admin" };
    next();
  },
}));
vi.mock("../db", () => ({
  dbAdapter: { getCredentials, createCredential, updateCredential, deleteCredential, getInstances },
}));
vi.mock("../crypto", () => ({ encrypt: (value: string) => `encrypted:${value}` }));
vi.mock("../utils/sanitizer", () => ({
  isMaskedSecretPlaceholder: (value: unknown) => typeof value === "string" && value.includes("••••"),
  sanitizeCredentialsForClient: (values: unknown) => values,
}));
vi.mock("../utils/ip", () => ({ getClientIp: () => "127.0.0.1" }));
vi.mock("express-rate-limit", () => ({
  default: (options: any) => {
    limiterOptions.current = options;
    return (_req: any, _res: any, next: any) => next();
  },
}));

import credentialsRouter from "./credentials";

async function request(method: string, path: string, body?: unknown) {
  const app = express();
  app.use(express.json());
  app.use("/api/credentials", credentialsRouter);
  const server = app.listen(0);

  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP port");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/credentials${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { response, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe("credentials API error contract", () => {
  afterEach(() => vi.clearAllMocks());
  beforeEach(() => {
    getInstances.mockResolvedValue([]);
  });

  it("configures the write limiter with a stable error code", () => {
    expect(limiterOptions.current.message).toMatchObject({
      code: ErrorCodes.CREDENTIAL_RATE_LIMITED,
      error: expect.any(String),
    });
  });

  it("rejects missing create fields with a stable code", async () => {
    const { response, body } = await request("POST", "/", { name: "OpenAI" });
    expect(response.status).toBe(400);
    expect(body).toMatchObject({ code: ErrorCodes.CREDENTIAL_FIELDS_REQUIRED });
  });

  it("rejects masked secrets with a stable code", async () => {
    const { response, body } = await request("POST", "/", {
      name: "OpenAI",
      type: "openai",
      key: "••••••••",
    });
    expect(response.status).toBe(400);
    expect(body).toMatchObject({ code: ErrorCodes.CREDENTIAL_SECRET_INVALID });
  });

  it("returns a stable code when listing fails", async () => {
    getCredentials.mockRejectedValueOnce(new Error("database offline"));
    const { response, body } = await request("GET", "/");
    expect(response.status).toBe(500);
    expect(body).toMatchObject({ code: ErrorCodes.CREDENTIALS_LOAD_FAILED });
  });

  it("returns a stable code when creation fails", async () => {
    createCredential.mockRejectedValueOnce(new Error("database offline"));
    const { response, body } = await request("POST", "/", {
      name: "OpenAI",
      type: "openai",
      key: "real-key",
    });
    expect(response.status).toBe(500);
    expect(body).toMatchObject({ code: ErrorCodes.CREDENTIAL_CREATE_FAILED });
  });

  it("returns a stable code when updating fails", async () => {
    updateCredential.mockRejectedValueOnce(new Error("database offline"));
    const { response, body } = await request("PATCH", "/credential-id", { name: "Updated" });
    expect(response.status).toBe(500);
    expect(body).toMatchObject({ code: ErrorCodes.CREDENTIAL_UPDATE_FAILED });
  });

  it("returns a stable code when deletion fails", async () => {
    deleteCredential.mockRejectedValueOnce(new Error("credential in use"));
    const { response, body } = await request("DELETE", "/credential-id");
    expect(response.status).toBe(500);
    expect(body).toMatchObject({ code: ErrorCodes.CREDENTIAL_DELETE_FAILED });
  });

  it("allows deletion when only deleted instances retain a stale credential reference", async () => {
    getInstances.mockResolvedValueOnce([
      {
        id: "deleted-instance",
        name: "Deleted Agent",
        status: "deleted",
        config_json: JSON.stringify({ providerCredentialId: "credential-id" }),
      },
    ]);

    const { response, body } = await request("DELETE", "/credential-id");

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(deleteCredential).toHaveBeenCalledWith("credential-id", userId);
  });

  it("blocks deletion while a credential is referenced by an instance", async () => {
    getInstances.mockResolvedValueOnce([
      {
        id: "instance-1",
        name: "Customer support",
        config_json: JSON.stringify({ providerCredentialId: "credential-id" }),
      },
    ]);
    const { response, body } = await request("DELETE", "/credential-id");
    expect(response.status).toBe(409);
    expect(body).toMatchObject({ code: ErrorCodes.CREDENTIAL_IN_USE });
    expect(body.details.instances).toEqual([{ id: "instance-1", name: "Customer support" }]);
    expect(deleteCredential).not.toHaveBeenCalled();
  });
});