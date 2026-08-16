import { dbAdapter } from "../db";
import { isQuotaConsumingStatus } from "../utils/quota";
import { buildInstancePublicUrl } from "../utils/publicUrl";
import { resolveInstanceDiskLimitMb } from "../services/instances/instanceStorageQuotaService";

async function enrichDiskLimitsForInstancesBatch(instances: any[]): Promise<any[]> {
  if (!instances || instances.length === 0) return instances;

  for (const instance of instances) {
    try {
      const mb = await resolveInstanceDiskLimitMb(instance);
      instance.limitsDisk = mb === null ? "unlimited" : `${mb}MB`;

      let config: any = {};
      if (instance.config_json) {
        try {
          config = typeof instance.config_json === 'string' ? JSON.parse(instance.config_json) : instance.config_json;
        } catch (e) {}
      }
      instance.diskLimitSource = config.diskLimitMode || "inherit";
    } catch (err) {
      console.error("[instancesRepo] Failed to batch enrich disk limits for instance:", instance.id, err);
    }
  }

  return instances;
}

async function enrichDiskLimitForInstance(instance: any): Promise<any> {
  if (!instance) return instance;
  try {
    const mb = await resolveInstanceDiskLimitMb(instance);
    instance.limitsDisk = mb === null ? "unlimited" : `${mb}MB`;

    let config: any = {};
    if (instance.config_json) {
      try {
        config = typeof instance.config_json === 'string' ? JSON.parse(instance.config_json) : instance.config_json;
      } catch (e) {}
    }
    instance.diskLimitSource = config.diskLimitMode || "inherit";
  } catch (err) {
    console.error("[instancesRepo] Failed to dynamically enrich disk limits:", err);
  }
  return instance;
}

export const instancesRepo = {
  toInstanceDbRow(instance: any) {
    const config_json = typeof instance.config_json === 'string' 
      ? JSON.parse(instance.config_json) 
      : instance.config_json;

    const userId = instance.user_id || instance.owner_id;
    const pathSlug = instance.path || config_json?.path || config_json?.slug;
    const generatedUrl = pathSlug ? buildInstancePublicUrl(pathSlug, config_json?.host_port || config_json?.port, { mode: config_json?.deployment_mode, host: config_json?.instance_access_host }) : null;
    const isLocal = ["local", "lan"].includes((process.env.PROXY_MODE || "local").toLowerCase());
    const url = isLocal ? generatedUrl : (instance.url || instance.public_url || generatedUrl);

    const rawCpu = instance.limitsCpu ?? config_json?.limitsCpu ?? 0.5;
    let limitsCpuNum: number = 0.5;
    if (typeof rawCpu === 'number') {
      limitsCpuNum = rawCpu;
    } else if (typeof rawCpu === 'string' && rawCpu.trim() !== '') {
      const parsed = parseFloat(rawCpu);
      if (!isNaN(parsed)) {
        limitsCpuNum = parsed;
      }
    }

    const limitsMemory = instance.limitsMemory ?? instance.limitsMem ?? config_json?.limitsMemory ?? config_json?.limitsMem ?? '512MB';

    const rawMemoryMb = instance.limitsMemoryMb ?? config_json?.limitsMemoryMb;
    let limitsMemoryMbVal: number | null = null;
    if (rawMemoryMb !== undefined && rawMemoryMb !== null) {
      const parsed = typeof rawMemoryMb === 'number' ? rawMemoryMb : parseInt(String(rawMemoryMb));
      if (!isNaN(parsed)) {
        limitsMemoryMbVal = parsed;
      }
    } else if (typeof limitsMemory === 'string' && limitsMemory.toLowerCase().endsWith('mb')) {
      const parsed = parseInt(limitsMemory);
      if (!isNaN(parsed)) {
        limitsMemoryMbVal = parsed;
      }
    } else if (typeof limitsMemory === 'string' && limitsMemory.toLowerCase().endsWith('g')) {
      const parsed = parseFloat(limitsMemory);
      if (!isNaN(parsed)) {
        limitsMemoryMbVal = Math.round(parsed * 1024);
      }
    }

    const limitsStorage = instance.limitsStorage ?? config_json?.limitsStorage ?? null;
    const limitsDisk = instance.limitsDisk ?? config_json?.limitsDisk ?? null;
    const limitsTimeout = instance.limitsTimeout ?? config_json?.limitsTimeout ?? null;

    return {
      id: instance.id,
      name: instance.name,
      path: instance.path,
      status: instance.status,
      url: url,
      public_url: url,
      created_at: instance.createdAt || instance.created_at,
      updated_at: instance.updatedAt || instance.updated_at,
      config_json: config_json,
      user_id: userId,
      owner_id: userId,
      agent_image: instance.agent_image || process.env.MY_BAY_IMAGE || 'nousresearch/hermes-agent',
      agent_image_tag: instance.agent_image_tag || process.env.MY_BAY_IMAGE_TAG || 'latest',
      agent_version: instance.agent_version || process.env.MY_BAY_IMAGE_TAG || 'latest',
      resolved_version: instance.resolved_version || null,
      previous_image_tag: instance.previous_image_tag || null,
      last_upgrade_at: instance.last_upgrade_at || null,
      upgrade_status: instance.upgrade_status || null,
      upgrade_error: instance.upgrade_error || null,
      deployment_error: instance.deployment_error || null,
      container_name: instance.container_name || null,
      data_volume_path: instance.data_volume_path || null,
      env_config: instance.env_config || null,
      traefik_labels: instance.traefik_labels || null,
      started_at: instance.started_at || null,
      archived: instance.archived ? true : false,
      archived_at: instance.archived_at || null,
      physical_status: instance.physical_status || 'unknown',
      physical_error: instance.physical_error || null,
      last_reconciled_at: instance.last_reconciled_at || null,
      model_provider: instance.model_provider || null,
      model_name: instance.model_name || null,
      model_base_url: instance.model_base_url || null,
      model_config_status: instance.model_config_status || 'pending',
      model_config_error: instance.model_config_error || null,
      limitsCpu: limitsCpuNum,
      limitsMemory: limitsMemory,
      limitsMemoryMb: limitsMemoryMbVal,
      limitsStorage: limitsStorage,
      limitsDisk: limitsDisk,
      limitsTimeout: limitsTimeout ? (typeof limitsTimeout === 'number' ? limitsTimeout : parseInt(String(limitsTimeout))) : null,
      template_id: instance.template_id || null,
      template_slug: instance.template_slug || null,
    };
  },

  async getActiveInstancesCountByUserIds(userIds: string[]) {
    const all = await dbAdapter.getAllInstances();
    const idSet = new Set(userIds);
    const countMap: Record<string, number> = {};
    for (const row of all) {
      const ownerId = row.owner_id || row.user_id;
      if (!idSet.has(ownerId)) continue;
      if (row.archived || row.archived_at) continue;
      if (isQuotaConsumingStatus(row.status)) {
        countMap[ownerId] = (countMap[ownerId] || 0) + 1;
      }
    }
    return { data: Object.keys(countMap).map(id => ({ user_id: id, count: countMap[id] })) };
  },

  fromInstanceDbRow(row: any) {
    if (!row) return null;
    const resolvedUserId = row.owner_id || row.user_id;
    const metadata = row.metadata || {};

    const configJsonStr = typeof row.config_json === 'string' ? row.config_json : JSON.stringify(row.config_json || {});
    let blueprint_id: string | null = null;
    let blueprint_slug: string | null = null;
    let blueprint_version: string | null = null;
    let blueprint_snapshot: any = null;
    try {
      const parsed = JSON.parse(configJsonStr || "{}");
      if (parsed.blueprint_id) blueprint_id = parsed.blueprint_id;
      if (parsed.blueprint_slug) blueprint_slug = parsed.blueprint_slug;
      if (parsed.blueprint_version) blueprint_version = parsed.blueprint_version;
      if (parsed.blueprint_snapshot) blueprint_snapshot = parsed.blueprint_snapshot;
    } catch (e) {}

    let configObjForUrl: any = {};
    try {
      configObjForUrl = JSON.parse(configJsonStr || "{}");
    } catch (e) {}
    const pathSlug = row.path || configObjForUrl?.path || configObjForUrl?.slug;
    const generatedUrl = pathSlug ? buildInstancePublicUrl(pathSlug, configObjForUrl?.host_port || configObjForUrl?.port, { mode: configObjForUrl?.deployment_mode, host: configObjForUrl?.instance_access_host }) : null;
    const isLocal = ["local", "lan"].includes((process.env.PROXY_MODE || "local").toLowerCase());
    const resolvedUrl = isLocal ? generatedUrl : (row.public_url || row.url || generatedUrl);

    return {
      ...row,
      blueprint_id,
      blueprint_slug,
      blueprint_version,
      blueprint_snapshot,
      gateway_status: metadata.gateway_status || (row.status === "gateway_ready" || row.status === "running" ? "running" : "unknown"),
      gateway_ready: metadata.gateway_ready !== undefined ? !!metadata.gateway_ready : (row.status === "gateway_ready" || row.status === "running"),
      gateway_checked_at: metadata.gateway_checked_at || null,
      gateway_error: metadata.gateway_error || null,
      gateway_services: metadata.gateway_services || null,
      configured_channels: metadata.configured_channels !== undefined ? metadata.configured_channels : null,
      connected_channels: metadata.connected_channels !== undefined ? metadata.connected_channels : null,
      channel_status: metadata.channel_status || null,
      user_id: resolvedUserId,
      owner_id: resolvedUserId,
      url: resolvedUrl,
      public_url: resolvedUrl,
      createdAt: row.created_at || row.createdAt,
      updatedAt: row.updated_at || row.updatedAt,
      config_json: configJsonStr,
      agent_image: row.agent_image || process.env.MY_BAY_IMAGE || 'nousresearch/hermes-agent',
      agent_image_tag: row.agent_image_tag || process.env.MY_BAY_IMAGE_TAG || 'latest',
      agent_version: row.agent_version || process.env.MY_BAY_IMAGE_TAG || 'latest',
      resolved_version: row.resolved_version || null,
      previous_image_tag: row.previous_image_tag || null,
      last_upgrade_at: row.last_upgrade_at || null,
      upgrade_status: row.upgrade_status || null,
      upgrade_error: row.upgrade_error || null,
      deployment_error: row.deployment_error || null,
      container_name: row.container_name || null,
      data_volume_path: row.data_volume_path || null,
      env_config: row.env_config || null,
      traefik_labels: row.traefik_labels || null,
      started_at: row.started_at || null,
      archived: !!row.archived,
      archived_at: row.archived_at || null,
      physical_status: row.physical_status || 'unknown',
      physical_error: row.physical_error || null,
      last_reconciled_at: row.last_reconciled_at || null,
      limitsCpu: row.limitsCpu !== undefined && row.limitsCpu !== null ? String(row.limitsCpu) : "0.5",
      limitsMem: row.limitsMemory || row.limits_mem || row.limitsMem || "512MB",
      limitsMemory: row.limitsMemory || row.limits_mem || row.limitsMem || "512MB",
      limitsMemoryMb: row.limitsMemoryMb || null,
      limitsStorage: row.limitsStorage || null,
      limitsDisk: row.limitsDisk || null,
      limitsTimeout: row.limitsTimeout || null,
      template_id: row.template_id || null,
      template_slug: row.template_slug || null,
    };
  },

  async findAll() {
    const rows = await dbAdapter.getAllInstances();
    const instances = (rows || []).map(row => this.fromInstanceDbRow(row));
    return enrichDiskLimitsForInstancesBatch(instances);
  },

  async findByOwner(userId: string, role: string) {
    const rows = await dbAdapter.getInstances(userId, role);
    const instances = (rows || [])
      .map(row => this.fromInstanceDbRow(row))
      .sort((a: any, b: any) => String(b.created_at || b.createdAt || "").localeCompare(String(a.created_at || a.createdAt || "")));

    if (role === 'admin' && instances.length > 0) {
      for (const inst of instances) {
        const ownerId = inst.user_id || inst.owner_id;
        const user = ownerId ? await dbAdapter.getUserById(ownerId).catch(() => null) : null;
        if (user) {
          // @ts-ignore
          inst.owner = user.username || user.id;
        }
      }
    }
    return enrichDiskLimitsForInstancesBatch(instances);
  },

  async findByIdForOwner(id: string, userId?: string, role?: string) {
    const instance = await dbAdapter.getInstanceById(id);
    if (!instance) return null;
    const ownerId = instance.owner_id || instance.user_id;
    if (userId && role !== 'admin' && ownerId !== userId) return null;

    const user = ownerId ? await dbAdapter.getUserById(ownerId).catch(() => null) : null;
    const inst = this.fromInstanceDbRow(instance);
    if (inst) {
      inst.user_role = user?.role;
    }
    return enrichDiskLimitForInstance(inst);
  },

  async findByPath(path: string) {
    const instance = await dbAdapter.getInstanceByPath(path);
    if (!instance || instance.archived || instance.archived_at) return null;
    const inst = this.fromInstanceDbRow(instance);
    return enrichDiskLimitForInstance(inst);
  },

  async create(instance: any) {
    const row = this.toInstanceDbRow(instance);
    await dbAdapter.createInstance(row);
  },

  async updatePhysicalState(id: string, updates: any) {
    const patch: any = { ...updates };
    if (updates.physical_status !== undefined) patch.physical_status = updates.physical_status;
    if (updates.physical_error !== undefined) patch.physical_error = updates.physical_error;
    if (updates.last_reconciled_at !== undefined) patch.last_reconciled_at = updates.last_reconciled_at;
    await dbAdapter.updateInstancePhysicalState(id, patch);
  },

  async updateVersionInfo(id: string, updates: any) {
    await dbAdapter.updateInstanceVersionInfo(id, { ...updates, updated_at: new Date().toISOString() });
  },

  async updateConfig(id: string, configJson: string) {
    const configObj = typeof configJson === 'string' ? JSON.parse(configJson) : configJson;
    await dbAdapter.updateInstanceConfig(id, JSON.stringify(configObj));
  },

  async updateName(id: string, name: string) {
    await dbAdapter.updateInstanceName(id, name);
  },

  async updateStatus(id: string, status: string) {
    await dbAdapter.updateInstanceStatus(id, status);
  },

  async archive(id: string) {
    await dbAdapter.updateInstanceRecord(id, { status: 'stopped', archived: true, archived_at: new Date().toISOString() });
    return { changes: 1 };
  },

  async unarchive(id: string) {
    await dbAdapter.updateInstanceRecord(id, { archived: false, archived_at: null });
    return { changes: 1 };
  },

  async delete(id: string) {
    return dbAdapter.deleteInstance(id);
  },
};
