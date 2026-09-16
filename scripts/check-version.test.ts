import { describe, expect, it } from "vitest";
import { buildRuntimePublicMetadata, checkRuntimeBridgeMetadata, checkRuntimePublicMetadata, checkVersionConsistency } from "./check-version.mjs";

const packageJson = { name: "mybay-local", version: "0.1.0-preview" };
const packageLock = { name: "mybay-local", version: "0.1.0-preview", packages: { "": { name: "mybay-local", version: "0.1.0-preview" } } };
const publicMetadata = {
  readmes: [
    { name: "README.md", content: "Release status: v0.1.0-preview" },
    { name: "README.zh-CN.md", content: "发布状态：v0.1.0-preview" },
  ],
  changelogs: [{ name: "marketing.json", releases: [{ version: "v0.1.0-preview" }] }],
};

const runtimeBridgeMetadata = {
  name: "Codex bridge",
  release: { bridgeVersion: "0.1.0-experimental.4", nativeVersion: "0.154.0" },
  packageJson: { version: "0.1.0-experimental.4", dependencies: { "@openai/codex": "0.154.0" } },
  packageLock: {
    version: "0.1.0-experimental.4",
    packages: {
      "": { version: "0.1.0-experimental.4", dependencies: { "@openai/codex": "0.154.0" } },
      "node_modules/@openai/codex": { version: "0.154.0" },
    },
  },
  nativePackage: "@openai/codex",
  dockerfile: { name: "runtime/codex-bridge/Dockerfile", content: 'com.mybay.codex.bridge-version="0.1.0-experimental.4" com.mybay.codex.agent-version="0.154.0"' },
  dockerLabels: { bridge: "com.mybay.codex.bridge-version", native: "com.mybay.codex.agent-version" },
  references: [{ name: "README.md", content: "Codex bridge 0.1.0-experimental.4" }],
};

describe("release version consistency", () => {
  it("accepts matching package and public release metadata", () => {
    expect(checkVersionConsistency(packageJson, packageLock, publicMetadata)).toEqual([]);
  });

  it("accepts a four-part maintenance release version", () => {
    const maintenancePackage = { ...packageJson, version: "0.1.27.1" };
    const maintenanceLock = {
      ...packageLock,
      version: "0.1.27.1",
      packages: { "": { ...packageLock.packages[""], version: "0.1.27.1" } },
    };
    const maintenanceMetadata = {
      readmes: [{ name: "README.md", content: "Release status: v0.1.27.1" }],
      changelogs: [{ name: "marketing.json", releases: [{ version: "v0.1.27.1" }] }],
    };
    expect(checkVersionConsistency(maintenancePackage, maintenanceLock, maintenanceMetadata)).toEqual([]);
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

  it("accepts aligned Runtime bridge release metadata", () => {
    expect(checkRuntimeBridgeMetadata([runtimeBridgeMetadata])).toEqual([]);
  });

  it("rejects stale Runtime bridge packages, labels, and documentation", () => {
    const errors = checkRuntimeBridgeMetadata([{
      ...runtimeBridgeMetadata,
      packageJson: { version: "0.1.0-experimental.3", dependencies: { "@openai/codex": "0.153.0" } },
      dockerfile: { name: "runtime/codex-bridge/Dockerfile", content: "" },
      references: [{ name: "README.md", content: "Codex bridge 0.1.0-experimental.3" }],
    }]);
    expect(errors).toContain("Codex bridge package version (0.1.0-experimental.3) does not match release bridgeVersion (0.1.0-experimental.4)");
    expect(errors).toContain("Codex bridge native dependency (0.153.0) does not match release nativeVersion (0.154.0)");
    expect(errors).toContain("runtime/codex-bridge/Dockerfile does not label bridgeVersion 0.1.0-experimental.4");
    expect(errors).toContain("README.md does not identify the current Codex bridge version as 0.1.0-experimental.4");
  });

  it("accepts public Runtime entries derived from the catalog specs", () => {
    const specs = [{
      name: "hermes-agent",
      displayName: "Hermes Agent",
      version: "v2026.8.27",
      release: { certificationLevel: "certified", bridgeVersion: null },
    }];
    const runtimes = buildRuntimePublicMetadata(specs, [
      { name: "README.md", content: "- **Hermes Agent:** Runtime v2026.8.27 is `certified`." },
      { name: "README.zh-CN.md", content: "- **Hermes Agent：** Runtime v2026.8.27 已达到 `certified`。" },
    ]);
    expect(checkRuntimePublicMetadata(runtimes)).toEqual([]);
  });

  it("rejects missing and stale public Runtime entries", () => {
    const errors = checkRuntimePublicMetadata([{
      displayName: "Pi Agent",
      version: "0.85.1",
      release: { certificationLevel: "certified", bridgeVersion: "0.1.1-beta" },
      references: [
        { name: "README.md", content: "- **Pi Agent:** Pi 0.85.0 at beta with bridge 0.1.0." },
        { name: "README.zh-CN.md", content: "" },
      ],
    }]);
    expect(errors).toContain("README.md does not identify Pi Agent Runtime version 0.85.1");
    expect(errors).toContain("README.md does not identify Pi Agent certification level certified");
    expect(errors).toContain("README.md does not identify Pi Agent bridge version 0.1.1-beta");
    expect(errors).toContain("README.zh-CN.md is missing the public Pi Agent release entry");
  });
});
