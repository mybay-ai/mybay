import { describe, expect, it } from "vitest";
import { checkVersionConsistency } from "./check-version.mjs";

const packageJson = { name: "mybay-local", version: "0.1.0-preview" };
const packageLock = { name: "mybay-local", version: "0.1.0-preview", packages: { "": { name: "mybay-local", version: "0.1.0-preview" } } };
const publicMetadata = {
  readmes: [
    { name: "README.md", content: "Release status: v0.1.0-preview" },
    { name: "README.zh-CN.md", content: "发布状态：v0.1.0-preview" },
  ],
  changelogs: [{ name: "marketing.json", releases: [{ version: "v0.1.0-preview" }] }],
};

describe("release version consistency", () => {
  it("accepts matching package and public release metadata", () => {
    expect(checkVersionConsistency(packageJson, packageLock, publicMetadata)).toEqual([]);
  });

  it("reports mismatched lockfile metadata", () => {
    const errors = checkVersionConsistency(packageJson, { ...packageLock, version: "0.0.9" }, publicMetadata);
    expect(errors).toContain("package-lock.json version (0.0.9) does not match package.json (0.1.0-preview)");
  });

  it("rejects conflicting public README and changelog versions", () => {
    const errors = checkVersionConsistency(packageJson, packageLock, {
      readmes: [{ name: "README.md", content: "Release status: v0.2.0" }],
      changelogs: [{ name: "marketing.json", releases: [{ version: "v0.2.0" }] }],
    });
    expect(errors).toContain("README.md does not identify the current public release as v0.1.0-preview");
    expect(errors).toContain("marketing.json contains public release v0.2.0; expected only v0.1.0-preview");
  });
});
