import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({ dbAdapter: { getMyBayVersions: vi.fn(async () => []) } }));
import { resolveRestoredRuntimeMetadata } from "./restoreRuntimeSelection";

describe("restored Runtime selection", () => {
  const previousEnabled = process.env.MYBAY_ENABLE_PI_RUNTIME;
  const previousImage = process.env.MYBAY_PI_RUNTIME_IMAGE;

  beforeEach(() => {
    process.env.MYBAY_ENABLE_PI_RUNTIME = "true";
    process.env.MYBAY_PI_RUNTIME_IMAGE = "mybay/pi-runtime:0.1.0-beta";
  });

  afterEach(() => {
    if (previousEnabled === undefined) delete process.env.MYBAY_ENABLE_PI_RUNTIME;
    else process.env.MYBAY_ENABLE_PI_RUNTIME = previousEnabled;
    if (previousImage === undefined) delete process.env.MYBAY_PI_RUNTIME_IMAGE;
    else process.env.MYBAY_PI_RUNTIME_IMAGE = previousImage;
  });

  it("preserves the Pi Runtime binding and selects the pinned Pi image", async () => {
    const configData = { runtime_type: " PI ", image: "nousresearch/hermes-agent:v2026.8.31" };
    const result = await resolveRestoredRuntimeMetadata({ configData, userRole: "admin" });

    expect(result).toMatchObject({
      ok: true,
      binding: { runtimeType: "pi", providerKey: "pi-rpc", contractVersion: 1 },
      selection: {
        agent_image: "mybay/pi-runtime",
        agent_image_tag: "0.1.0-beta",
        agent_version: "0.85.0",
      },
    });
    expect(configData.runtime_type).toBe("pi");
  });

  it("fails closed when the restored Runtime is not registered", async () => {
    const result = await resolveRestoredRuntimeMetadata({ configData: { runtime_type: "unknown" }, userRole: "admin" });
    expect(result).toMatchObject({ ok: false, status: 400, body: { code: "UNSUPPORTED_RUNTIME_TYPE" } });
  });
});
