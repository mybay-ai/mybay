import { describe, expect, it } from "vitest";
import { buildRuntimeCatalogResponse } from "./runtimes";

describe("runtime catalog route", () => {
  it("advertises Pi Certified capabilities but keeps deployment disabled by default", async () => {
    const response = buildRuntimeCatalogResponse(false, false);
    expect(response.schemaVersion).toBe(1);
    expect(response.runtimes.map((runtime) => runtime.runtime.type)).toEqual(["hermes", "pi", "codex"]);

    expect(response.runtimes[2].release).toMatchObject({ certificationLevel: "experimental", deploymentSupported: false });
    expect(buildRuntimeCatalogResponse(false, true).runtimes[2].release.deploymentSupported).toBe(true);
    const hermes = response.runtimes[0];
    expect(hermes.release).toMatchObject({ supportStatus: "available", deploymentSupported: true });
    expect(hermes.runtime).toMatchObject({ image: "nousresearch/hermes-agent", internalPort: 9119 });

    const pi = response.runtimes[1];
    expect(pi.release).toEqual({
      supportStatus: "available",
      certificationLevel: "certified",
      deploymentSupported: false,
    });
    expect(pi.capabilities).toMatchObject({
      chat: true,
      fileUpload: true,
      scheduledTasks: false,
      browser: false,
      shell: true,
      imChannels: ["web"],
    });
    expect(pi.lifecycle.conversation.modes).toEqual(["streaming"]);
    expect(buildRuntimeCatalogResponse(true).runtimes[1].release.deploymentSupported).toBe(true);
  });
});
