import { describe, expect, it } from "vitest";
import { parsePiRuntimeImageRef } from "./localPiRuntime";

describe("local Pi Runtime image identity", () => {
  it("keeps the deployed image and persisted version metadata aligned", () => {
    expect(parsePiRuntimeImageRef("mybay/pi-runtime:0.1.0-beta")).toEqual({
      image: "mybay/pi-runtime",
      tag: "0.1.0-beta",
    });
    expect(parsePiRuntimeImageRef("registry.example.test:5443/team/pi:beta")).toEqual({
      image: "registry.example.test:5443/team/pi",
      tag: "beta",
    });
  });

  it("rejects mutable or malformed untagged references", () => {
    expect(() => parsePiRuntimeImageRef("mybay/pi-runtime")).toThrowError(/explicit tag/);
    expect(() => parsePiRuntimeImageRef("mybay/pi-runtime:")).toThrowError(/explicit tag/);
  });
});
