import { describe, expect, it } from "vitest";
import { buildRuntimeCatalogResponse } from "./runtimes";

describe("runtime catalog route", () => {
  it("returns the registered Runtime definitions without advertising Pi capabilities", async () => {
    const response = buildRuntimeCatalogResponse();
    expect(response.schemaVersion).toBe(1);
    expect(response.runtimes.map((runtime) => runtime.runtime.type)).toEqual(["hermes", "pi"]);

    const hermes = response.runtimes[0];
    expect(hermes.release).toMatchObject({ supportStatus: "available", deploymentSupported: true });
    expect(hermes.runtime).toMatchObject({ image: "nousresearch/hermes-agent", internalPort: 9119 });

    const pi = response.runtimes[1];
    expect(pi.release).toEqual({
      supportStatus: "spec-only",
      certificationLevel: "spec-only",
      deploymentSupported: false,
    });
    expect(pi.capabilities).toMatchObject({
      chat: false,
      fileUpload: false,
      scheduledTasks: false,
      browser: false,
      shell: false,
      imChannels: [],
    });
    expect(pi.lifecycle.conversation.modes).toEqual([]);
  });
});
