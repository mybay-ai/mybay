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
  SecurityOpt: string[];
  ReadonlyRootfs: boolean;
  User: string;
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

