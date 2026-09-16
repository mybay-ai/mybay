import { describe, expect, it } from "vitest";
import { getDeployRuntimeDisplayName } from "./runtimePresentation";

describe("deploy runtime presentation", () => {
  it.each([
    ["hermes", "Hermes Agent"],
    ["pi", "Pi Agent"],
    ["codex", "Codex"],
  ])("uses the registered display name for %s", (runtimeType, expected) => {
    expect(getDeployRuntimeDisplayName(runtimeType)).toBe(expected);
  });

  it("normalizes known values and preserves an unknown runtime identifier", () => {
    expect(getDeployRuntimeDisplayName(" CODEX ")).toBe("Codex");
    expect(getDeployRuntimeDisplayName("future-runtime")).toBe("future-runtime");
  });
});
