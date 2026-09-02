import { describe, expect, it } from "vitest";
import { RUNTIME_DEFINITIONS } from "./runtimeCatalog";

describe("Runtime catalog", () => {
  it("keeps runtime and provider identities unique", () => {
    expect(new Set(RUNTIME_DEFINITIONS.map((definition) => definition.runtime.type)).size)
      .toBe(RUNTIME_DEFINITIONS.length);
    expect(new Set(RUNTIME_DEFINITIONS.map((definition) => definition.providerKey)).size)
      .toBe(RUNTIME_DEFINITIONS.length);
  });

  it("fails closed for spec-only runtimes", () => {
    for (const definition of RUNTIME_DEFINITIONS.filter((item) => item.release.supportStatus === "spec-only")) {
      expect(definition.release.deploymentSupported).toBe(false);
      expect(definition.release.certificationLevel).toBe("spec-only");
      expect(definition.lifecycle.conversation.modes).toEqual([]);
      expect(definition.lifecycle.cancellation.supported).toBe(false);
      expect(definition.lifecycle.terminal.observation).toBe("unsupported");
      expect(Object.values(definition.capabilities).filter((value) => value === true)).toEqual([]);
      expect(definition.capabilities.imChannels).toEqual([]);
    }
  });

  it("freezes registered definitions so capabilities cannot drift at runtime", () => {
    for (const definition of RUNTIME_DEFINITIONS) {
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.capabilities)).toBe(true);
      expect(Object.isFrozen(definition.lifecycle)).toBe(true);
      expect(Object.isFrozen(definition.capabilities.imChannels)).toBe(true);
    }
  });
});
