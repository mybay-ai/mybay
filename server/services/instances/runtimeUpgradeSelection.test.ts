import { afterEach, describe, expect, it } from "vitest";
import { resolveCodexRuntimeUpgradeSelection, resolvePiRuntimeUpgradeSelection } from "./runtimeUpgradeSelection";

const originalImage = process.env.MYBAY_PI_RUNTIME_IMAGE;

afterEach(() => {
  if (originalImage === undefined) delete process.env.MYBAY_PI_RUNTIME_IMAGE;
  else process.env.MYBAY_PI_RUNTIME_IMAGE = originalImage;
});

describe("Pi Runtime upgrade selection", () => {
  it("resolves latest and the Agent version to the pinned supported image", () => {
    process.env.MYBAY_PI_RUNTIME_IMAGE = "registry.test/mybay/pi:0.85.1";
    expect(resolvePiRuntimeUpgradeSelection({ instance: { runtime_type: "pi" }, targetTag: "latest" })).toMatchObject({
      ok: true,
      selection: { image: "registry.test/mybay/pi", tag: "0.85.1", version: "0.85.1" },
    });
    expect(resolvePiRuntimeUpgradeSelection({ instance: { runtime_type: "pi" }, targetTag: "0.85.1" })).toMatchObject({
      ok: true,
      selection: { imageRef: "registry.test/mybay/pi:0.85.1" },
    });
  });

  it("resolves the published image tag through the same catalog entry", () => {
    process.env.MYBAY_PI_RUNTIME_IMAGE = "registry.test/mybay/pi:0.85.1";
    expect(resolvePiRuntimeUpgradeSelection({ instance: { runtime_type: "pi" }, targetTag: "0.1.0-beta" })).toMatchObject({
      ok: true,
      selection: { imageRef: "mybay/pi-runtime:0.1.0-beta", version: "0.85.0" },
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

describe("Codex Runtime upgrade selection", () => {
  it("resolves latest, native versions and image tags through the admitted catalog", () => {
    expect(resolveCodexRuntimeUpgradeSelection({ instance: { runtime_type: "codex" }, targetTag: "latest" })).toMatchObject({
      ok: true,
      selection: { imageRef: "mybay/codex-runtime:0.154.0", version: "0.154.0" },
    });
    expect(resolveCodexRuntimeUpgradeSelection({ instance: { runtime_type: "codex" }, targetTag: "0.153.4" })).toMatchObject({
      ok: true,
      selection: { imageRef: "mybay/codex-runtime:0.153.4", version: "0.153.4" },
    });
  });

  it("rejects arbitrary tags but permits the recorded rollback tag only on rollback", () => {
    const instance = { runtime_type: "codex", agent_image: "mybay/codex-runtime", previous_image_tag: "retained-build" };
    expect(resolveCodexRuntimeUpgradeSelection({ instance, targetTag: "retained-build" })).toMatchObject({
      ok: false,
      code: "CODEX_RUNTIME_VERSION_NOT_SUPPORTED",
    });
    expect(resolveCodexRuntimeUpgradeSelection({ instance, targetTag: "retained-build", allowPreviousTag: true })).toMatchObject({
      ok: true,
      selection: { imageRef: "mybay/codex-runtime:retained-build" },
    });
  });
});
