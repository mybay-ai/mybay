import { afterEach, describe, expect, it } from "vitest";
import { resolvePiRuntimeUpgradeSelection } from "./runtimeUpgradeSelection";

const originalImage = process.env.MYBAY_PI_RUNTIME_IMAGE;

afterEach(() => {
  if (originalImage === undefined) delete process.env.MYBAY_PI_RUNTIME_IMAGE;
  else process.env.MYBAY_PI_RUNTIME_IMAGE = originalImage;
});

describe("Pi Runtime upgrade selection", () => {
  it("resolves latest and the Agent version to the pinned supported image", () => {
    process.env.MYBAY_PI_RUNTIME_IMAGE = "registry.test/mybay/pi:0.1.0-beta";
    expect(resolvePiRuntimeUpgradeSelection({ instance: { runtime_type: "pi" }, targetTag: "latest" })).toMatchObject({
      ok: true,
      selection: { image: "registry.test/mybay/pi", tag: "0.1.0-beta", version: "0.85.0" },
    });
    expect(resolvePiRuntimeUpgradeSelection({ instance: { runtime_type: "pi" }, targetTag: "0.85.0" })).toMatchObject({
      ok: true,
      selection: { imageRef: "registry.test/mybay/pi:0.1.0-beta" },
    });
  });

  it("allows only the recorded previous tag through the rollback path", () => {
    const instance = { runtime_type: "pi", agent_image: "mybay/pi-runtime", previous_image_tag: "0.1.0-experimental" };
    expect(resolvePiRuntimeUpgradeSelection({ instance, targetTag: "0.1.0-experimental" })).toMatchObject({
      ok: false,
      code: "PI_RUNTIME_VERSION_NOT_SUPPORTED",
    });
    expect(resolvePiRuntimeUpgradeSelection({ instance, targetTag: "0.1.0-experimental", allowPreviousTag: true })).toMatchObject({
      ok: true,
      selection: { imageRef: "mybay/pi-runtime:0.1.0-experimental" },
    });
  });
});
