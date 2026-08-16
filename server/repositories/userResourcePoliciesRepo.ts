import { dbAdapter } from "../db";
import fs from "fs";
import path from "path";
import { DEFAULT_USER_DISK_LIMIT_MB } from "../constants/resourceLimits";

const LOCAL_FALLBACK_FILE = path.join(process.cwd(), "data", "user_resource_policies.json");

function ensureDirectoryExistence(filePath: string) {
  const dirname = path.dirname(filePath);
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, { recursive: true });
  }
}

export interface UserResourcePolicy {
  id: string;
  user_id: string;
  default_cpu_limit: number;
  default_memory_limit_mb: number;
  max_cpu_limit: number;
  max_memory_limit_mb: number;
  resource_plan: string;
  disk_limit_mb?: number | null;
  default_instance_disk_mb?: number;
  max_single_instance_disk_mb?: number | null;
  created_at?: string;
  updated_at?: string;
  updated_by?: string;
}

let localPoliciesCache: UserResourcePolicy[] = [];
if (fs.existsSync(LOCAL_FALLBACK_FILE)) {
  try {
    localPoliciesCache = JSON.parse(fs.readFileSync(LOCAL_FALLBACK_FILE, "utf-8"));
  } catch (e) {
    localPoliciesCache = [];
  }
}

function saveLocal(policies: UserResourcePolicy[]) {
  ensureDirectoryExistence(LOCAL_FALLBACK_FILE);
  fs.writeFileSync(LOCAL_FALLBACK_FILE, JSON.stringify(policies, null, 2), "utf-8");
  localPoliciesCache = policies;
}

function normalizePolicy(policy: any): UserResourcePolicy | null {
  if (!policy) return null;
  return {
    ...policy,
    disk_limit_mb: policy.disk_limit_mb === "unlimited" ? null : (policy.disk_limit_mb === undefined ? DEFAULT_USER_DISK_LIMIT_MB : (policy.disk_limit_mb === null ? null : Number(policy.disk_limit_mb))),
    default_instance_disk_mb: policy.default_instance_disk_mb === undefined ? 512 : Number(policy.default_instance_disk_mb),
    max_single_instance_disk_mb: policy.max_single_instance_disk_mb === "unlimited" ? null : (policy.max_single_instance_disk_mb === undefined ? 2048 : (policy.max_single_instance_disk_mb === null ? null : Number(policy.max_single_instance_disk_mb)))
  };
}

export const userResourcePoliciesRepo = {
  async getByUserId(userId: string): Promise<UserResourcePolicy | null> {
    const found = await dbAdapter.getUserResourcePolicy(userId);
    if (found) return normalizePolicy(found);
    const localFallback = localPoliciesCache.find(p => p.user_id === userId);
    return localFallback ? normalizePolicy(localFallback) : null;
  },

  async getByUserIds(userIds: string[]): Promise<UserResourcePolicy[]> {
    if (!userIds || userIds.length === 0) return [];
    const policies = await dbAdapter.listAllUserResourcePolicies();
    const merged = [...policies, ...localPoliciesCache.filter(p => !policies.some((stored: any) => stored.user_id === p.user_id))];
    return merged.filter((p: any) => userIds.includes(p.user_id)).map((p: any) => normalizePolicy(p)!).filter(Boolean) as UserResourcePolicy[];
  },

  async listAll(): Promise<UserResourcePolicy[]> {
    const policies = await dbAdapter.listAllUserResourcePolicies();
    const merged = [...policies, ...localPoliciesCache.filter(p => !policies.some((stored: any) => stored.user_id === p.user_id))];
    return merged.map((p: any) => normalizePolicy(p)!).filter(Boolean) as UserResourcePolicy[];
  },

  async upsert(policy: Partial<UserResourcePolicy> & { user_id: string }): Promise<UserResourcePolicy> {
    const existing = await this.getByUserId(policy.user_id);
    const now = new Date().toISOString();
    
    const dbDiskLimit = policy.disk_limit_mb !== undefined
      ? (String(policy.disk_limit_mb) === "unlimited" || policy.disk_limit_mb === null ? null : Number(policy.disk_limit_mb))
      : (existing?.disk_limit_mb !== undefined ? existing.disk_limit_mb : DEFAULT_USER_DISK_LIMIT_MB);

    const dbDefaultInstanceDisk = policy.default_instance_disk_mb !== undefined
      ? Number(policy.default_instance_disk_mb)
      : (existing?.default_instance_disk_mb ?? 512);

    const dbMaxSingleInstanceDisk = policy.max_single_instance_disk_mb !== undefined
      ? (String(policy.max_single_instance_disk_mb) === "unlimited" || policy.max_single_instance_disk_mb === null ? null : Number(policy.max_single_instance_disk_mb))
      : (existing?.max_single_instance_disk_mb !== undefined ? existing.max_single_instance_disk_mb : 2048);

    const newPolicy: UserResourcePolicy = {
      id: existing?.id || ("pol_" + Math.random().toString(36).substring(2, 10)),
      user_id: policy.user_id,
      default_cpu_limit: policy.default_cpu_limit !== undefined ? Number(policy.default_cpu_limit) : (existing?.default_cpu_limit ?? 0.5),
      default_memory_limit_mb: policy.default_memory_limit_mb !== undefined ? Number(policy.default_memory_limit_mb) : (existing?.default_memory_limit_mb ?? 512),
      max_cpu_limit: policy.max_cpu_limit !== undefined ? Number(policy.max_cpu_limit) : (existing?.max_cpu_limit ?? 0.5),
      max_memory_limit_mb: policy.max_memory_limit_mb !== undefined ? Number(policy.max_memory_limit_mb) : (existing?.max_memory_limit_mb ?? 512),
      resource_plan: policy.resource_plan || (existing?.resource_plan ?? "默认安全配额型"),
      disk_limit_mb: dbDiskLimit,
      default_instance_disk_mb: dbDefaultInstanceDisk,
      max_single_instance_disk_mb: dbMaxSingleInstanceDisk,
      created_at: existing?.created_at || now,
      updated_at: now,
      updated_by: policy.updated_by || "system"
    };

    const saved = await dbAdapter.upsertUserResourcePolicy(newPolicy) as UserResourcePolicy;

    const list = localPoliciesCache.filter(p => p.user_id !== policy.user_id);
    list.push(saved);
    saveLocal(list);

    return saved;
  }
};
