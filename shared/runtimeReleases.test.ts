import { describe, expect, it } from "vitest";
import { findRuntimeRelease, getLatestRuntimeRelease, listRuntimeReleases } from "./runtimeReleases";

describe("Runtime release catalog", () => {
  it("resolves the certified Pi release through every supported alias", () => {
    const latest = getLatestRuntimeRelease("pi");
    expect(latest).toMatchObject({
      runtimeType: "pi",
      runtimeVersion: "0.85.0",
      imageTag: "0.1.0-beta",
      certificationLevel: "certified",
      isLatest: true,
      upgradeable: true,
    });
    expect(findRuntimeRelease("pi", "latest")).toBe(latest);
    expect(findRuntimeRelease("pi", "0.85.0")).toBe(latest);
    expect(findRuntimeRelease("pi", "0.1.0-beta")).toBe(latest);
    expect(findRuntimeRelease("pi", "unknown")).toBeNull();
  });

  it("does not expose releases for runtimes managed by another repository", () => {
    expect(listRuntimeReleases("hermes")).toEqual([]);
  });
});
