import { dbAdapter } from "../../db";
import { getLocalResourcePolicy } from "../../services/localResourcePolicy";
import { isAdvancedResourceConfigEnabled } from "../advancedResourceConfigFeature";

export function parseCpuToNum(cpuStr: any): number {
  if (typeof cpuStr === 'number') return cpuStr;
  if (!cpuStr) return 0.5;
  const parsed = parseFloat(String(cpuStr));
  return isNaN(parsed) ? 0.5 : parsed;
}

export function parseMemoryToMb(memStr: any): number {
  if (typeof memStr === 'number') return memStr;
  if (!memStr) return 512;
  const s = String(memStr).toLowerCase().trim();
  if (s.endsWith('gb') || s.endsWith('g')) {
    const parsed = parseFloat(s);
    return isNaN(parsed) ? 512 : Math.round(parsed * 1024);
  }
  if (s.endsWith('mb') || s.endsWith('m')) {
    const parsed = parseInt(s, 10);
    return isNaN(parsed) ? 512 : parsed;
  }
  const parsed = parseInt(s, 10);
  return isNaN(parsed) ? 512 : parsed;
}

export function formatMemoryStr(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(0)}GB`;
  }
  return `${mb}MB`;
}

export async function resolveResourceLimitsForInstance(
  requestUser: any,
  requestedCpuStr: any,
  requestedMemStr: any,
  targetUserId: string,
  options: { preserveExisting?: boolean } = {}
) {
  const localPolicy = getLocalResourcePolicy();
  if (!isAdvancedResourceConfigEnabled()) {
    const cpu = options.preserveExisting && requestedCpuStr
      ? parseCpuToNum(requestedCpuStr)
      : Math.max(0.5, localPolicy.defaultCpu);
    const memoryMb = options.preserveExisting && requestedMemStr
      ? parseMemoryToMb(requestedMemStr)
      : Math.max(512, localPolicy.defaultMemoryMb);

    return {
      limitsCpu: String(cpu),
      limitsMem: formatMemoryStr(memoryMb),
      limitsMemoryMb: memoryMb
    };
  }

  const policy = await dbAdapter.getUserResourcePolicy(targetUserId);

  const isAdmin = requestUser.role === "admin" || requestUser.role === "super_admin";
  const allowedDefaultCpu = isAdmin ? localPolicy.defaultCpu : (policy ? policy.default_cpu_limit : localPolicy.defaultCpu);
  const allowedDefaultMemMb = isAdmin ? localPolicy.defaultMemoryMb : (policy ? policy.default_memory_limit_mb : localPolicy.defaultMemoryMb);
  const allowedMaxCpu = isAdmin ? localPolicy.maxCpu : (policy ? policy.max_cpu_limit : localPolicy.maxCpu);
  const allowedMaxMemMb = isAdmin ? localPolicy.maxMemoryMb : (policy ? policy.max_memory_limit_mb : localPolicy.maxMemoryMb);

  let finalCpu = allowedDefaultCpu;
  let finalMemMb = allowedDefaultMemMb;

  if (requestUser.role === 'admin') {
    const requestedCpu = requestedCpuStr ? parseCpuToNum(requestedCpuStr) : allowedDefaultCpu;
    const requestedMemMb = requestedMemStr ? parseMemoryToMb(requestedMemStr) : allowedDefaultMemMb;

    finalCpu = Math.min(requestedCpu, localPolicy.maxCpu);
    finalMemMb = Math.min(requestedMemMb, localPolicy.maxMemoryMb);
  } else {
    const requestedCpu = requestedCpuStr ? parseCpuToNum(requestedCpuStr) : allowedDefaultCpu;
    const requestedMemMb = requestedMemStr ? parseMemoryToMb(requestedMemStr) : allowedDefaultMemMb;

    finalCpu = Math.min(requestedCpu, allowedMaxCpu);
    finalMemMb = Math.min(requestedMemMb, allowedMaxMemMb);
  }

  return {
    limitsCpu: String(finalCpu),
    limitsMem: formatMemoryStr(finalMemMb),
    limitsMemoryMb: finalMemMb
  };
}
