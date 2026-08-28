import { beforeEach, describe, expect, it, vi } from "vitest";

const external = vi.hoisted(() => ({
  getInstanceById: vi.fn(),
  resolveInstanceInternalApiKey: vi.fn(),
  requestTraefikInternal: vi.fn(),
  streamTraefikInternalSse: vi.fn()
}));

vi.mock("../../../db", () => ({ dbAdapter: { getInstanceById: external.getInstanceById } }));
vi.mock("../../../utils/instanceInternalApiKey", () => ({
  resolveInstanceInternalApiKey: external.resolveInstanceInternalApiKey
}));
vi.mock("../../../utils/traefikInternalRequest", () => ({
  requestTraefikInternal: external.requestTraefikInternal
}));
vi.mock("../../../utils/traefikInternalSse", () => ({
  streamTraefikInternalSse: external.streamTraefikInternalSse
}));

import {
  sanitizeIdempotencyKey,
  sanitizeRunsRequestHeaders,
  streamHermesRunEventsAPI
} from "./HermesTransport";

describe("HermesTransport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    external.getInstanceById.mockResolvedValue({ id: "instance-1" });
    external.resolveInstanceInternalApiKey.mockReturnValue({ ok: true, apiKey: "internal-key" });
    external.streamTraefikInternalSse.mockResolvedValue(undefined);
  });

  it("accepts only bounded idempotency-key characters", () => {
    expect(sanitizeIdempotencyKey(" run_1:attempt-2 ")).toBe("run_1:attempt-2");
    expect(sanitizeIdempotencyKey("contains space")).toBeUndefined();
    expect(sanitizeIdempotencyKey("x".repeat(257))).toBeUndefined();
  });

  it("drops every non-allowlisted request header", () => {
    expect(sanitizeRunsRequestHeaders({ Authorization: "secret", Cookie: "secret" })).toBeUndefined();
    expect(sanitizeRunsRequestHeaders({
      Authorization: "secret",
      "Idempotency-Key": "run-1"
    })).toEqual({ "Idempotency-Key": "run-1" });
  });

  it("ignores invalid upstream run ids before loading the instance", async () => {
    await streamHermesRunEventsAPI("instance-1", "invalid/id", new AbortController().signal, vi.fn());

    expect(external.getInstanceById).not.toHaveBeenCalled();
    expect(external.streamTraefikInternalSse).not.toHaveBeenCalled();
  });

  it("opens the validated run event stream with the resolved internal key", async () => {
    const controller = new AbortController();
    const onChunk = vi.fn();

    await streamHermesRunEventsAPI("instance-1", "upstream.run-1", controller.signal, onChunk);

    expect(external.streamTraefikInternalSse).toHaveBeenCalledWith({
      instanceId: "instance-1",
      path: "/v1/runs/upstream.run-1/events",
      apiKey: "internal-key",
      signal: controller.signal,
      onChunk
    });
  });
});
