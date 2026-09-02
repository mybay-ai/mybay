import { describe, expect, it } from "vitest";
import { buildUpgradePreflight } from "./upgradePreflightService";

const base = { instance: { id: "i1", name: "Agent", status: "running", gateway_ready: true, agent_image_tag: "v1", data_volume_path: "/data" }, targetTag: "v2", targetCompatible: true, disk: { totalBytes: 10 * 1024 ** 3, freeBytes: 5 * 1024 ** 3 }, configValid: true, dataDirectoryExists: true, currentContainerRunning: true, targetImageCached: true, architectureCompatible: true };

describe("upgrade preflight", () => {
  it("allows a healthy upgrade while retaining the interruption warning", () => {
    const result = buildUpgradePreflight(base);
    expect(result.allowed).toBe(true);
    expect(result.summary.warnings).toBe(1);
  });

  it("blocks incompatible targets and missing data", () => {
    const result = buildUpgradePreflight({ ...base, targetCompatible: false, dataDirectoryExists: false });
    expect(result.allowed).toBe(false);
    expect(result.summary.blockers).toBe(2);
  });

  it("blocks critically low disk space", () => {
    const result = buildUpgradePreflight({ ...base, disk: { totalBytes: 10 * 1024 ** 3, freeBytes: 100 * 1024 ** 2 } });
    expect(result.checks.find(check => check.code === "DISK_SPACE")?.status).toBe("blocker");
  });
});
