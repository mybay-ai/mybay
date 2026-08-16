import { describe, expect, it } from "vitest";
import { isAdvancedResourceConfigEnabled } from "./advancedResourceConfigFeature";

describe("isAdvancedResourceConfigEnabled", () => {
  it("defaults to disabled", () => {
    expect(isAdvancedResourceConfigEnabled({})).toBe(false);
  });

  it("only enables explicit true", () => {
    expect(isAdvancedResourceConfigEnabled({ MYBAY_ADVANCED_RESOURCE_CONFIG_ENABLED: "TRUE" })).toBe(true);
    expect(isAdvancedResourceConfigEnabled({ MYBAY_ADVANCED_RESOURCE_CONFIG_ENABLED: "1" })).toBe(false);
    expect(isAdvancedResourceConfigEnabled({ MYBAY_ADVANCED_RESOURCE_CONFIG_ENABLED: "false" })).toBe(false);
  });
});
