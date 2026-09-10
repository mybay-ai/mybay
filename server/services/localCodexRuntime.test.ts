import { describe, expect, it } from "vitest";
import { ensureLocalCodexRuntimeImage } from "./localCodexRuntime";

describe("local Codex Runtime image admission", () => {
  it("accepts a cached supported rollback image with matching immutable labels", async () => {
    const imageRef = await ensureLocalCodexRuntimeImage({
      imageRef: "mybay/codex-runtime:0.153.4",
      dockerClient: {
        getImage: () => ({ inspect: async () => ({ Config: { Labels: {
          "com.mybay.codex.runtime": "true",
          "com.mybay.codex.agent-version": "0.153.4",
          "com.mybay.codex.bridge-version": "0.1.0-experimental.2",
        } } }) }),
      },
    });
    expect(imageRef).toBe("mybay/codex-runtime:0.153.4");
  });

  it("rejects unlisted images and mismatched rollback labels", async () => {
    await expect(ensureLocalCodexRuntimeImage({
      imageRef: "example.invalid/codex:0.154.0",
      dockerClient: {},
    })).rejects.toThrow("CODEX_IMAGE_UNSUPPORTED");
    await expect(ensureLocalCodexRuntimeImage({
      imageRef: "mybay/codex-runtime:0.153.4",
      dockerClient: {
        getImage: () => ({ inspect: async () => ({ Config: { Labels: {
          "com.mybay.codex.runtime": "true",
          "com.mybay.codex.agent-version": "0.154.0",
          "com.mybay.codex.bridge-version": "0.1.0-experimental.2",
        } } }) }),
      },
    })).rejects.toThrow("CODEX_IMAGE_UNVERIFIED");
  });
});
