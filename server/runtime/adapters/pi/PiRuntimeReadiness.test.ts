import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveKey: vi.fn(),
  request: vi.fn(),
}));

vi.mock("../../../utils/instanceInternalApiKey", () => ({
  resolveInstanceInternalApiKey: mocks.resolveKey,
}));
vi.mock("../../../utils/traefikInternalRequest", () => ({
  requestTraefikInternal: mocks.request,
}));

import { probePiRuntimeReadiness } from "./PiRuntimeReadiness";

describe("Pi runtime readiness", () => {
  beforeEach(() => {
    mocks.resolveKey.mockReset();
    mocks.request.mockReset();
  });

  it("accepts the authenticated Pi capability contract", async () => {
    mocks.resolveKey.mockReturnValue({ ok: true, apiKey: "test-key" });
    mocks.request.mockResolvedValue({
      ok: true,
      statusCode: 200,
      json: { runtime: "pi", features: { run_submission: true, run_status: true } },
    });

    await expect(probePiRuntimeReadiness({ id: "pi-instance" })).resolves.toMatchObject({
      gateway_ready: true,
      gateway_status: "running",
      chat_ready: true,
      gateway_services: { pi_rpc_bridge: "running" },
    });
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({
      instanceId: "pi-instance",
      path: "/v1/capabilities",
      apiKey: "test-key",
    }));
  });

  it("fails closed when the internal bridge key is unavailable", async () => {
    mocks.resolveKey.mockReturnValue({ ok: false, error: "HERMES_INTERNAL_API_KEY_MISSING" });
    await expect(probePiRuntimeReadiness({ id: "pi-instance" })).resolves.toMatchObject({
      gateway_ready: false,
      gateway_status: "auth_missing",
      chat_ready: false,
    });
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
