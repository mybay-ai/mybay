import { beforeEach, describe, expect, it, vi } from "vitest";

const requestTraefikInternal = vi.hoisted(() => vi.fn());
const resolveInstanceInternalApiKey = vi.hoisted(() => vi.fn(() => ({ ok: true, apiKey: "test-key" })));

vi.mock("./traefikInternalRequest", () => ({ requestTraefikInternal }));
vi.mock("./instanceInternalApiKey", () => ({ resolveInstanceInternalApiKey }));

import { normalizeHermesRunsCapabilities, probeCapabilitiesDetailed } from "./capabilities";

describe("Hermes Runs capability probing", () => {
  beforeEach(() => {
    requestTraefikInternal.mockReset();
    resolveInstanceInternalApiKey.mockReturnValue({ ok: true, apiKey: "test-key" });
  });

  it("recognizes the required Runs features", () => {
    expect(normalizeHermesRunsCapabilities({
      features: { run_submission: true, run_status: true, tool_progress_events: true }
    })).toMatchObject({ state: "supported", runsSupported: true, toolProgressEvents: true });
  });

  it("reports explicit unsupported only for a valid capability response without Runs", () => {
    expect(normalizeHermesRunsCapabilities({
      features: { run_submission: true, run_status: false }
    }).state).toBe("explicitly_unsupported");
  });

  it.each([
    ["401", { ok: false, statusCode: 401, json: { error: "unauthorized" } }],
    ["500", { ok: false, statusCode: 500, json: { error: "failure" } }],
    ["connection failure", { ok: false, statusCode: 0, error: "ECONNREFUSED" }]
  ])("treats %s as unavailable and retries instead of caching unsupported", async (_label, response) => {
    requestTraefikInternal.mockResolvedValue(response);
    const instance = { id: `instance-${_label}`, status: "running", updated_at: "1", version: "test" };

    expect((await probeCapabilitiesDetailed(instance)).state).toBe("unavailable");
    expect((await probeCapabilitiesDetailed(instance)).state).toBe("unavailable");
    expect(requestTraefikInternal).toHaveBeenCalledTimes(2);
  });

  it("treats a timeout exception as unavailable and does not cache it", async () => {
    requestTraefikInternal.mockRejectedValue(new Error("ETIMEDOUT"));
    const instance = { id: "instance-timeout", status: "running", updated_at: "1", version: "test" };

    expect((await probeCapabilitiesDetailed(instance)).state).toBe("unavailable");
    expect((await probeCapabilitiesDetailed(instance)).state).toBe("unavailable");
    expect(requestTraefikInternal).toHaveBeenCalledTimes(2);
  });
});
