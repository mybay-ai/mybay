import { describe, expect, it } from "vitest";
import { getDockerProfile, getResourceLimits } from "../../dockerDeployment";

describe("docker resource policy characterization", () => {
  it("normalizes configured CPU and memory while preserving runtime limits", () => {
    expect(getResourceLimits({ limitsMem: "2GB", limitsCpu: "1.5" })).toEqual({
      Memory: 2 * 1024 * 1024 * 1024,
      MemorySwap: 4 * 1024 * 1024 * 1024,
      NanoCPUs: 1_500_000_000,
      NanoCpus: 1_500_000_000,
      LogConfig: {
        Type: "json-file",
        Config: { "max-size": "50m", "max-file": "3" }
      },
      PidsLimit: 512,
      Ulimits: [{ Name: "nproc", Soft: 512, Hard: 512 }]
    });
  });

  it("enforces the established minimums for invalid limits", () => {
    const limits = getResourceLimits({ limitsMem: "128MB", limitsCpu: "0" });
    expect(limits.Memory).toBe(512 * 1024 * 1024);
    expect(limits.MemorySwap).toBe(1024 * 1024 * 1024);
    expect(limits.NanoCPUs).toBe(1_000_000_000);
    expect(limits.NanoCpus).toBe(1_000_000_000);
  });

  it("preserves each runtime security profile", () => {
    expect(getDockerProfile("console-runtime")).toEqual({
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      ReadonlyRootfs: false,
      User: "root"
    });
    expect(getDockerProfile("sandbox-skill-runtime")).toEqual({
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      ReadonlyRootfs: true,
      User: "sandbox"
    });
    expect(getDockerProfile("mybay-agent-runtime")).toEqual({
      CapDrop: [],
      SecurityOpt: [],
      ReadonlyRootfs: false,
      User: "root"
    });
  });
});

