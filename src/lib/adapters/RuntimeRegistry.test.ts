import { describe, expect, it } from "vitest";
import { runtimeRegistry } from "./RuntimeRegistry";

describe("client RuntimeRegistry", () => {
  it("uses the shared Runtime catalog and fails closed for unknown runtimes", () => {
    const runtimes = runtimeRegistry.listRegisteredRuntimes();
    expect(runtimes.map((runtime) => runtime.type)).toEqual(["hermes", "pi"]);
    expect(runtimes[0].manifest.runtime.image).toBe("nousresearch/hermes-agent");
    expect(runtimes[1].manifest.release).toEqual({
      supportStatus: "spec-only",
      certificationLevel: "spec-only",
      deploymentSupported: false,
    });
    expect(runtimes[1].manifest.capabilities).toMatchObject({
      chat: false,
      fileUpload: false,
      browser: false,
      shell: false,
      imChannels: [],
    });
    expect(() => runtimeRegistry.getAdapter("unknown-runtime")).toThrow("is not registered");
  });
});
