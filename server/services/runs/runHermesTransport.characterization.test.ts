import { beforeEach, describe, expect, it, vi } from "vitest";

const external = vi.hoisted(() => ({
  getInstanceById: vi.fn(),
  resolveInstanceInternalApiKey: vi.fn(),
  requestTraefikInternal: vi.fn(),
  streamTraefikInternalSse: vi.fn()
}));

vi.mock("../../db", () => ({
  dbAdapter: { getInstanceById: external.getInstanceById }
}));
vi.mock("../../utils/instanceInternalApiKey", () => ({
  resolveInstanceInternalApiKey: external.resolveInstanceInternalApiKey
}));
vi.mock("../../utils/traefikInternalRequest", () => ({
  requestTraefikInternal: external.requestTraefikInternal
}));
vi.mock("../../utils/traefikInternalSse", () => ({
  streamTraefikInternalSse: external.streamTraefikInternalSse
}));

import { requestRunsAPI } from "../runsReconciler";

describe("Hermes transport characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    external.getInstanceById.mockResolvedValue({ id: "instance-1" });
    external.resolveInstanceInternalApiKey.mockReturnValue({ ok: true, apiKey: "internal-key" });
    external.requestTraefikInternal.mockResolvedValue({
      ok: true,
      statusCode: 202,
      json: { id: "upstream-run" }
    });
  });

  it("returns 404 without making an upstream request when the instance is missing", async () => {
    external.getInstanceById.mockResolvedValue(null);

    await expect(requestRunsAPI({ instanceId: "missing", method: "GET", path: "/v1/runs" }))
      .resolves.toEqual({ ok: false, statusCode: 404, error: "INSTANCE_NOT_FOUND" });
    expect(external.requestTraefikInternal).not.toHaveBeenCalled();
  });

  it("returns the key resolution error without contacting upstream", async () => {
    external.resolveInstanceInternalApiKey.mockReturnValue({ ok: false, error: "KEY_INVALID" });

    await expect(requestRunsAPI({ instanceId: "instance-1", method: "GET", path: "/v1/runs" }))
      .resolves.toEqual({ ok: false, statusCode: 400, error: "KEY_INVALID" });
    expect(external.requestTraefikInternal).not.toHaveBeenCalled();
  });

  it("forwards only a valid canonical idempotency key and the Hermes session id", async () => {
    const result = await requestRunsAPI({
      instanceId: "instance-1",
      method: "POST",
      path: "/v1/runs",
      body: { input: "hello" },
      headers: {
        "idempotency-key": "  run:key-1  ",
        Authorization: "must-not-forward"
      },
      hermesSessionId: "session-1",
      timeoutMs: 3210
    });

    expect(result).toEqual({ ok: true, statusCode: 202, json: { id: "upstream-run" }, error: undefined });
    expect(external.requestTraefikInternal).toHaveBeenCalledWith({
      instanceId: "instance-1",
      method: "POST",
      path: "/v1/runs",
      apiKey: "internal-key",
      body: { input: "hello" },
      timeoutMs: 3210,
      headers: { "Idempotency-Key": "run:key-1" },
      hermesSessionId: "session-1"
    });
  });

  it("drops invalid idempotency keys and maps an upstream raw-body error", async () => {
    external.requestTraefikInternal.mockResolvedValue({
      ok: false,
      statusCode: 503,
      rawBody: "upstream unavailable"
    });

    await expect(requestRunsAPI({
      instanceId: "instance-1",
      method: "POST",
      path: "/v1/runs",
      headers: { "Idempotency-Key": "invalid key" }
    })).resolves.toEqual({
      ok: false,
      statusCode: 503,
      json: undefined,
      error: "upstream unavailable"
    });
    expect(external.requestTraefikInternal).toHaveBeenCalledWith(expect.objectContaining({ headers: undefined }));
  });

  it("normalizes thrown transport errors to the reconciler request error contract", async () => {
    external.requestTraefikInternal.mockRejectedValue(new Error("socket closed"));

    await expect(requestRunsAPI({ instanceId: "instance-1", method: "GET", path: "/v1/runs" }))
      .resolves.toEqual({ ok: false, statusCode: 500, error: "socket closed" });
  });
});
