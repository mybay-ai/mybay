import { describe, expect, it } from "vitest";
import { compareHermesVersions, sortHermesVersionsDescending } from "./version";

describe("Hermes version ordering", () => {
  it("compares four-part Hermes tags", () => {
    expect(compareHermesVersions("v2026.7.7.2", "v2026.7.7")).toBeGreaterThan(0);
    expect(compareHermesVersions("v2026.8.1", "v2026.7.30")).toBeGreaterThan(0);
  });

  it("accepts date tags and SemVer with or without a v prefix", () => {
    expect(compareHermesVersions("v2026.8.13", "2026.8.12")).toBeGreaterThan(0);
    expect(compareHermesVersions("v0.20.1", "0.20.0")).toBeGreaterThan(0);
    expect(compareHermesVersions("0.20.1", "v0.20.1")).toBe(0);
  });

  it("places stable releases after prereleases", () => {
    expect(compareHermesVersions("v2026.8.1", "v2026.8.1-rc.1")).toBeGreaterThan(0);
    expect(sortHermesVersionsDescending(["v2026.7.7", "v2026.7.7.2"], (v) => v)[0]).toBe("v2026.7.7.2");
  });
});
