function parseBytes(memStr: string | undefined): number {
  if (!memStr || memStr === "0") return 0;
  memStr = memStr.toLowerCase().trim();
  const val = parseFloat(memStr);
  if (isNaN(val)) return 0;
  if (memStr.endsWith("g") || memStr.endsWith("gb")) return val * 1024 * 1024 * 1024;
  if (memStr.endsWith("m") || memStr.endsWith("mb")) return val * 1024 * 1024;
  if (memStr.endsWith("k") || memStr.endsWith("kb")) return val * 1024;
  return val;
}

export function getResourceLimits(config?: any) {
  const limits: any = {};

  let memLimitStr = (config?.limitsMem !== undefined && config?.limitsMem !== null && config?.limitsMem !== "")
    ? config.limitsMem
    : process.env.DEFAULT_INSTANCE_MEMORY || process.env.INSTANCE_MEMORY_LIMIT;
  if (!memLimitStr || memLimitStr === "") memLimitStr = "1024MB";
  let memLimit = parseBytes(memLimitStr);

  const minMemory = 512 * 1024 * 1024;
  if (memLimit <= 0 || memLimit < minMemory) memLimit = minMemory;

  limits.Memory = memLimit;
  limits.MemorySwap = memLimit * 2;

  let cpuLimitStr = (config?.limitsCpu !== undefined && config?.limitsCpu !== null && config?.limitsCpu !== "")
    ? config.limitsCpu
    : process.env.DEFAULT_INSTANCE_CPUS || process.env.INSTANCE_CPU_LIMIT;
  if (!cpuLimitStr || cpuLimitStr === "") cpuLimitStr = "1";

  let cpus = parseFloat(cpuLimitStr);
  if (isNaN(cpus) || cpus <= 0) cpus = 1;

  limits.NanoCPUs = Math.floor(cpus * 1000000000);
  limits.NanoCpus = Math.floor(cpus * 1000000000);
  limits.LogConfig = {
    Type: "json-file",
    Config: {
      "max-size": "50m",
      "max-file": "3"
    }
  };
  limits.PidsLimit = 512;
  limits.Ulimits = [{ Name: "nproc", Soft: 512, Hard: 512 }];

  return limits;
}

export interface DockerProfile {
  CapDrop: string[];
  CapAdd?: string[];
  SecurityOpt: string[];
  ReadonlyRootfs: boolean;
  User: string;
}

export function getAgentContainerSecurityProfile(agentRuntimeType: unknown): DockerProfile {
  const runtimeType = String(agentRuntimeType || "hermes").trim().toLowerCase();
  if (["pi", "codex"].includes(runtimeType)) {
    return {
      CapDrop: ["ALL"],
      CapAdd: [],
      SecurityOpt: ["no-new-privileges:true"],
      ReadonlyRootfs: true,
      User: "node",
    };
  }
  if (runtimeType === "hermes") {
    return {
      CapDrop: ["ALL"],
      // The pinned upstream image uses a root-owned s6-overlay supervisor
      // which drops the Agent processes to uid 10000. These are the bounded
      // capabilities required for initialization and graceful shutdown.
      CapAdd: ["CHOWN", "DAC_OVERRIDE", "KILL", "SETGID", "SETUID"],
      // no-new-privileges prevents the upstream s6 stage0 transition.
      SecurityOpt: [],
      ReadonlyRootfs: true,
      User: "root",
    };
  }
  return getDockerProfile("mybay-agent-runtime");
}

export function getAgentContainerTmpfs(agentRuntimeType: unknown): Record<string, string> {
  const runtimeType = String(agentRuntimeType || "hermes").trim().toLowerCase();
  if (runtimeType === "hermes") {
    return {
      "/tmp": "rw,noexec,nosuid,nodev,size=128m,mode=1777",
      // s6-overlay stages its supervision tree here and must execute it.
      "/run": "rw,suid,exec,size=32m,mode=0755",
    };
  }
  if (["pi", "codex"].includes(runtimeType)) {
    return { "/tmp": "rw,noexec,nosuid,nodev,size=64m,mode=1777" };
  }
  return {};
}

export function supportsAgentContainerNoNewPrivileges(agentRuntimeType: unknown): boolean {
  // The pinned Hermes image needs its root-owned s6 stage0 process to perform
  // the uid/gid transition to the unprivileged Agent user. Docker's
  // no-new-privileges flag blocks that initialization path.
  return String(agentRuntimeType || "hermes").trim().toLowerCase() !== "hermes";
}

export function getDockerProfile(runtimeType: "console-runtime" | "mybay-agent-runtime" | "sandbox-skill-runtime"): DockerProfile {
  if (runtimeType === "console-runtime") {
    return {
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      ReadonlyRootfs: false,
      User: "root"
    };
  } else if (runtimeType === "sandbox-skill-runtime") {
    return {
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      ReadonlyRootfs: true,
      User: "sandbox"
    };
  }

  return {
    CapDrop: [],
    SecurityOpt: [],
    ReadonlyRootfs: false,
    User: "root"
  };
}

