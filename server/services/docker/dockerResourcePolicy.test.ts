import { describe, expect, it } from "vitest";
import { getDockerProfile, getResourceLimits } from "../../dockerDeployment";
import {
  getAgentContainerSecurityProfile,
  getAgentContainerTmpfs,
  supportsAgentContainerNoNewPrivileges,
} from "./dockerResourcePolicy";

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

  it("uses the native bridge security profile for Pi and Codex", () => {
    expect(getAgentContainerSecurityProfile("pi")).toEqual({
      CapDrop: ["ALL"],
      CapAdd: [],
      SecurityOpt: ["no-new-privileges:true"],
      ReadonlyRootfs: true,
      User: "node",
    });
    expect(getAgentContainerSecurityProfile("codex")).toEqual(getAgentContainerSecurityProfile("pi"));
  });

  it("bounds the capabilities required by the pinned Hermes s6 image", () => {
    expect(getAgentContainerSecurityProfile("hermes")).toEqual({
      CapDrop: ["ALL"],
      CapAdd: ["CHOWN", "DAC_OVERRIDE", "KILL", "SETGID", "SETUID"],
      SecurityOpt: [],
      ReadonlyRootfs: true,
      User: "root",
    });
    expect(getAgentContainerSecurityProfile(undefined)).toEqual(getAgentContainerSecurityProfile("hermes"));
  });

  it("provides only the writable temporary filesystems each Runtime needs", () => {
    expect(getAgentContainerTmpfs("hermes")).toEqual({
      "/tmp": "rw,noexec,nosuid,nodev,size=128m,mode=1777",
      "/run": "rw,suid,exec,size=32m,mode=0755",
    });
    expect(getAgentContainerTmpfs("pi")).toEqual({
      "/tmp": "rw,noexec,nosuid,nodev,size=64m,mode=1777",
    });
    expect(getAgentContainerTmpfs("codex")).toEqual(getAgentContainerTmpfs("pi"));
    expect(getAgentContainerTmpfs("community-runtime")).toEqual({});
  });

  it("keeps no-new-privileges off only for the pinned Hermes initialization path", () => {
    expect(supportsAgentContainerNoNewPrivileges("hermes")).toBe(false);
    expect(supportsAgentContainerNoNewPrivileges(undefined)).toBe(false);
    expect(supportsAgentContainerNoNewPrivileges("pi")).toBe(true);
    expect(supportsAgentContainerNoNewPrivileges("codex")).toBe(true);
    expect(supportsAgentContainerNoNewPrivileges("community-runtime")).toBe(true);
  });
});

