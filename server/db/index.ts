import os from "os";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import {
  cancelDeploymentTasksForInstance,
  claimNextCleanupTask,
  claimNextDeploymentTask,
  createCleanupTaskCore,
  createDeploymentTaskCore,
  createProvisioningBundle,
  deleteProvisioningRecords,
  failExhaustedDeploymentTasks,
  getDeploymentTaskCore,
  getLatestCleanupTaskForInstance,
  getIdempotencyRecord,
  getPortReservation,
  listDeploymentTasksCore,
  mutateStore, nowIso, paginate, readStore,
  releasePortReservation,
  reservePortForInstance,
  renewDeploymentLease,
  updateCleanupTaskCore,
  updateDeploymentTaskCore,
} from "../localStore";

export function parseSemver(version: string) {
  const [major = 0, minor = 0, patch = 0] = String(version).replace(/^v/, "").split(/[.-]/).map((part) => parseInt(part, 10) || 0);
  return { major, minor, patch };
}

export function compareSemver(a: string, b: string) {
  const av = parseSemver(a);
  const bv = parseSemver(b);
  return av.major - bv.major || av.minor - bv.minor || av.patch - bv.patch;
}

function normalizeUsername(username: string) {
  return String(username || "").trim().toLowerCase();
}

function touch<T extends Record<string, any>>(row: T): T {
  const now = nowIso();
  const mutable = row as any;
  if (!mutable.created_at) mutable.created_at = now;
  mutable.updated_at = now;
  return row;
}

function upsertById(collection: any[], row: any) {
  const id = row.id || randomUUID();
  const index = collection.findIndex((item) => item.id === id);
  const next = touch({ ...row, id });
  if (index >= 0) collection[index] = { ...collection[index], ...next };
  else collection.push(next);
  return next;
}
export function retainNewestInstanceRows(collection: any[], instanceId: string, maxRows = 500) {
  const instanceRows = collection.filter((row) => row.instance_id === instanceId);
  if (instanceRows.length <= maxRows) return collection;
  const keepIds = new Set(instanceRows.sort((a, b) => String(b.timestamp || b.created_at || "").localeCompare(String(a.timestamp || a.created_at || ""))).slice(0, maxRows).map((row) => row.id));
  return collection.filter((row) => row.instance_id !== instanceId || keepIds.has(row.id));
}


export const dbAdapter = {
  async getUserByUsername(username: string) {
    const normalized = normalizeUsername(username);
    return readStore().users.find((u) => u.username_normalized === normalized || normalizeUsername(u.username) === normalized) || null;
  },

  async getUserById(id: string) {
    return readStore().users.find((u) => u.id === id) || null;
  },


  async createUser(user: any) {
    return mutateStore((data) => {
      const row = touch({ status: "active", ...user, username_normalized: user.username_normalized || normalizeUsername(user.username) });
      data.users.push(row);
      return row;
    });
  },

  async updateUserRole(username: string, role: string) {
    return mutateStore((data) => {
      const normalized = normalizeUsername(username);
      const user = data.users.find((u) => u.username_normalized === normalized || normalizeUsername(u.username) === normalized);
      if (!user) return { changes: 0 };
      user.role = role;
      user.updated_at = nowIso();
      return { changes: 1 };
    });
  },

  async updateUserProfile(id: string, updates: any) {
    return mutateStore((data) => {
      const user = data.users.find((u) => u.id === id);
      if (user) Object.assign(user, updates, { updated_at: nowIso() });
    });
  },

  async getUserCount() {
    return readStore().users.length;
  },

  async countActiveAdmins() {
    return readStore().users.filter((u) => u.role === "admin" && u.status !== "disabled").length;
  },

  async getAdminUsersList(params: { page: number; pageSize: number; search?: string; role?: string; status?: string }) {
    let users = [...readStore().users];
    if (params.search) {
      const q = params.search.toLowerCase();
      users = users.filter((u) => String(u.username || "").toLowerCase().includes(q) || u.id === params.search);
    }
    if (params.role) users = users.filter((u) => u.role === params.role);
    if (params.status) users = users.filter((u) => u.status === params.status);
    users.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    return { users: paginate(users, params.page, params.pageSize), total: users.length };
  },

  async updateAdminUser(id: string, updates: any) {
    return this.updateUserProfile(id, updates);
  },

  toInstanceDbRow(instance: any) { return instance; },
  fromInstanceDbRow(row: any) { return row; },

  async getAllInstances() {
    return readStore().instances.filter((i) => !i.archived_at);
  },

  async getInstances(userId: string, role: string) {
    const all = await this.getAllInstances();
    return role === "admin" ? all : all.filter((i: any) => i.user_id === userId || i.owner_id === userId);
  },

  async getInstanceById(id: string) {
    return readStore().instances.find((i) => i.id === id) || null;
  },

  async getInstanceByPath(instancePath: string) {
    return readStore().instances.find((i) => i.path === instancePath || i.instance_path === instancePath) || null;
  },

  async createInstance(instance: any) {
    return mutateStore((data) => {
      const row = touch({ status: "stopped", ...instance, id: instance.id || randomUUID() });
      data.instances.push(row);
      return row;
    });
  },

  async updateInstancePhysicalState(id: string, updates: any) { return this.updateInstanceRecord(id, updates); },
  async updateInstanceVersionInfo(id: string, updates: any) { return this.updateInstanceRecord(id, updates); },
  async updateInstanceConfig(id: string, configJson: string) { return this.updateInstanceRecord(id, { config_json: configJson }); },
  async updateInstanceName(id: string, name: string) { return this.updateInstanceRecord(id, { name }); },
  async updateInstanceStatus(id: string, status: string) { return this.updateInstanceRecord(id, { status }); },

  async updateInstanceRecord(id: string, updates: any) {
    return mutateStore((data) => {
      const inst = data.instances.find((i) => i.id === id);
      if (inst) Object.assign(inst, updates, { updated_at: nowIso() });
      return inst || null;
    });
  },

  async archiveInstance(id: string) { return this.updateInstanceRecord(id, { archived_at: nowIso(), status: "archived" }); },
  async unarchiveInstance(id: string) { return this.updateInstanceRecord(id, { archived_at: null, status: "stopped" }); },

  async deleteInstance(id: string) {
    return mutateStore((data) => {
      data.instances = data.instances.filter((i) => i.id !== id);
      data.auditLogs = data.auditLogs.filter((l) => l.instance_id !== id);
      return { changes: 1 };
    });
  },

  async getAuditLogs(instanceId: string) { return readStore().auditLogs.filter((l) => l.instance_id === instanceId); },
  async listAuditLogs() { return readStore().auditLogs.slice().sort((a, b) => String(b.timestamp || b.created_at || "").localeCompare(String(a.timestamp || a.created_at || ""))); },
  async insertAuditLog(log: any) {
    return mutateStore((data) => {
      const row = upsertById(data.auditLogs, log);
      data.auditLogs = retainNewestInstanceRows(data.auditLogs, row.instance_id);
      return row;
    });
  },
  async deleteAuditLogsForInstance(instanceId: string) { return mutateStore((data) => { data.auditLogs = data.auditLogs.filter((l) => l.instance_id !== instanceId); }); },

  async createDeploymentEvent(event: any) {
    return mutateStore((data) => {
      const row = upsertById(data.deploymentEvents, {
        ...event,
        status: event.status || "info",
        metadata: event.metadata || {},
        created_at: event.created_at || nowIso()
      });
      data.deploymentEvents = retainNewestInstanceRows(data.deploymentEvents, row.instance_id);
      return row;
    });
  },
  async listDeploymentEventsByInstance(instanceId: string) {
    return readStore().deploymentEvents
      .filter((e) => e.instance_id === instanceId)
      .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  },
  async getMyBayVersions() { return readStore().versions; },
  async getLatestMyBayVersion() { return readStore().versions.find((v) => v.is_latest) || readStore().versions[0] || null; },
  async upsertMyBayVersion(ver: any) { return mutateStore((data) => upsertById(data.versions, ver)); },
  async updatePrewarmStatus(imageTag: string, status: string, isFinished = false, image?: string) { return mutateStore((data) => { data.versions.filter((v) => v.image_tag === imageTag || v.version === imageTag).forEach((v) => Object.assign(v, { prewarm_status: status, is_prewarmed: isFinished, image: image || v.image, updated_at: nowIso() })); }); },
  async updateAllVersionsLatestFlag(latestVersion: string) { return mutateStore((data) => { data.versions.forEach((v) => v.is_latest = v.version === latestVersion); }); },
  async deleteStaleFeishuVariants(_validTags?: string[], _image?: string) { return { changes: 0 }; },

  async getOverviewStats(userId: string, role: string) {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const cpuCores = os.cpus().length || 1;
    const cpuUsage = Math.min(100, Math.round((os.loadavg()[0] / cpuCores) * 100));
    let diskTotal = 50 * 1024 * 1024 * 1024;
    let diskUsed = 0;
    try {
      const output = execFileSync(process.platform === "win32" ? "wmic" : "df", process.platform === "win32" ? ["logicaldisk", "get", "size,freespace,caption"] : ["-k", "/"]).toString();
      if (process.platform !== "win32") {
        const line = output.split("\n")[1]?.trim().split(/\s+/);
        if (line) { diskTotal = Number(line[1]) * 1024; diskUsed = Number(line[2]) * 1024; }
      }
    } catch {}
    const instances = await this.getInstances(userId, role);
    return {
      totalInstances: instances.length,
      runningInstances: instances.filter((i: any) => ["running", "partial_running"].includes(i.status)).length,
      stoppedInstances: instances.filter((i: any) => i.status === "stopped").length,
      deployingInstances: instances.filter((i: any) => i.status === "deploying").length,
      activeUsers: role === "admin" ? await this.getUserCount() : 1,
      cpuUsage,
      memTotal: totalMem,
      memUsed: totalMem - freeMem,
      diskTotal,
      diskUsed
    };
  },

  async getCredentials(userId: string) { return readStore().credentials.filter((c) => c.user_id === userId || c.owner_id === userId); },
  async getCredentialById(id: string, userId: string) { return readStore().credentials.find((c) => c.id === id && (c.user_id === userId || c.owner_id === userId)) || null; },
  async createCredential(cred: any) { return mutateStore((data) => upsertById(data.credentials, cred)); },
  async updateCredential(id: string, userId: string, updates: any) { return mutateStore((data) => { const cred = data.credentials.find((c) => c.id === id && (c.user_id === userId || c.owner_id === userId)); if (cred) Object.assign(cred, updates, { updated_at: nowIso() }); return cred || null; }); },
  async deleteCredential(id: string, userId: string) { return mutateStore((data) => { data.credentials = data.credentials.filter((c) => !(c.id === id && (c.user_id === userId || c.owner_id === userId))); return { changes: 1 }; }); },

  async createFileRecord(file: any) { return mutateStore((data) => upsertById(data.files, { deleted_at: null, ...file })); },
  async getFileRecordById(id: string) { return readStore().files.find((f) => f.id === id) || null; },
  async updateFileRecord(id: string, updates: any) { return mutateStore((data) => { const file = data.files.find((f) => f.id === id); if (file) Object.assign(file, updates, { updated_at: nowIso() }); return file || null; }); },
  async deleteFileRecord(id: string) { return mutateStore((data) => { data.files = data.files.filter((f) => f.id !== id); }); },
  async deleteFileRecordsByConversation(instanceId: string, conversationId: string) { return mutateStore((data) => { data.files = data.files.filter((f) => !(f.instance_id === instanceId && f.conversation_id === conversationId)); }); },
  async listFilesByConversation(instanceId: string, conversationId: string) { return readStore().files.filter((f) => f.instance_id === instanceId && f.conversation_id === conversationId && !f.deleted_at).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))); },
  async listUnboundFilesByOwner(ownerId: string) { return readStore().files.filter((f) => f.owner_id === ownerId && !f.instance_id); },
  async listLocalTemplates() { return readStore().templates; },
  async upsertLocalTemplate(template: any) { return mutateStore((data) => upsertById(data.templates, template)); },
  async getLocalTemplateById(id: string) { return readStore().templates.find((t) => t.id === id || t.slug === id) || null; },
  async updateLocalTemplate(id: string, updates: any) { return mutateStore((data) => { const row = data.templates.find((t) => t.id === id || t.slug === id); if (row) Object.assign(row, updates, { updated_at: nowIso() }); return row || null; }); },
  async listLocalBlueprints() { return readStore().blueprints; },
  async upsertLocalBlueprint(blueprint: any) { return mutateStore((data) => upsertById(data.blueprints, blueprint)); },
  async getLocalBlueprintById(id: string) { return readStore().blueprints.find((b) => b.id === id || b.slug === id) || null; },
  async updateLocalBlueprint(id: string, updates: any) { return mutateStore((data) => { const row = data.blueprints.find((b) => b.id === id || b.slug === id); if (row) Object.assign(row, updates, { updated_at: nowIso() }); return row || null; }); },
  async createTaskRecord(task: any) { return mutateStore((data) => upsertById(data.tasks, task)); },
  async listTasksByInstance(instanceId: string) { return readStore().tasks.filter((t) => t.instance_id === instanceId).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))); },
  async listTasksByOwner(ownerId: string) { return readStore().tasks.filter((t) => t.owner_id === ownerId).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))); },
  async getTaskRecordById(id: string) { return readStore().tasks.find((t) => t.id === id) || null; },
  async updateTaskRecord(id: string, updates: any) { return mutateStore((data) => { const task = data.tasks.find((t) => t.id === id); if (task) Object.assign(task, updates, { updated_at: nowIso() }); return task || null; }); },

  async createScheduledJob(job: any) { return mutateStore((data) => upsertById(data.scheduledJobs, job)); },
  async listScheduledJobsByInstance(instanceId: string) { return readStore().scheduledJobs.filter((j) => j.instance_id === instanceId).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))); },
  async listScheduledJobsByOwner(ownerId: string) { return readStore().scheduledJobs.filter((j) => j.owner_id === ownerId).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))); },
  async listDueScheduledJobs(now: string, limit = 20) { return readStore().scheduledJobs.filter((j) => j.is_active !== false && (!j.next_run_at || String(j.next_run_at) <= now)).slice(0, limit); },
  async getScheduledJobById(id: string) { return readStore().scheduledJobs.find((j) => j.id === id) || null; },
  async updateScheduledJob(id: string, updates: any) { return mutateStore((data) => { const job = data.scheduledJobs.find((j) => j.id === id); if (job) Object.assign(job, updates, { updated_at: nowIso() }); return job || null; }); },
  async claimScheduledFire(jobId: string, fireAt: string, snapshot: any) {
    return mutateStore((data) => {
      const idempotencyKey = `${jobId}:${fireAt}`;
      const existing = data.scheduledFires.find((fire) => fire.idempotency_key === idempotencyKey);
      if (existing) return { claimed: false, fire: existing };
      const fire = upsertById(data.scheduledFires, {
        job_id: jobId,
        instance_id: snapshot.instance_id,
        owner_id: snapshot.owner_id,
        template_id: snapshot.template_id,
        fire_at: fireAt,
        idempotency_key: idempotencyKey,
        status: "claimed",
        task_id: null,
        task_snapshot: snapshot,
        last_error: null
      });
      return { claimed: true, fire };
    });
  },
  async listRecoverableScheduledFires(limit = 20) {
    return readStore().scheduledFires.filter((fire) => ["claimed", "dispatched"].includes(fire.status)).slice(0, limit);
  },
  async getScheduledFireById(id: string) { return readStore().scheduledFires.find((fire) => fire.id === id) || null; },
  async findTaskByScheduledFireId(fireId: string) { return readStore().tasks.find((task) => task.scheduled_fire_id === fireId || task.input_payload?.scheduled_fire_id === fireId) || null; },
  async updateScheduledFire(id: string, updates: any) {
    return mutateStore((data) => {
      const fire = data.scheduledFires.find((item) => item.id === id);
      if (fire) Object.assign(fire, updates, { updated_at: nowIso() });
      return fire || null;
    });
  },
  async getUserResourcePolicy(userId: string) { return readStore().userResourcePolicies.find((p) => p.user_id === userId) || null; },
  async listAllUserResourcePolicies() { return readStore().userResourcePolicies; },
  async upsertUserResourcePolicy(policy: any) { return mutateStore((data) => upsertById(data.userResourcePolicies, policy)); },

  async upsertChannelAuthEvent(event: any) { return mutateStore((data) => upsertById(data.channelAuthEvents, event)); },
  async getChannelAuthEventsByInstance(instanceId: string) { return readStore().channelAuthEvents.filter((e) => e.instance_id === instanceId); },
  async getChannelAuthEventById(id: string) { return readStore().channelAuthEvents.find((e) => e.id === id) || null; },
  async updateChannelAuthEventStatus(id: string, status: string, approvedBy?: string) { return mutateStore((data) => { const event = data.channelAuthEvents.find((e) => e.id === id); if (event) { const now = nowIso(); Object.assign(event, { status, approved_by: approvedBy, approved_at: status === "approved" ? now : event.approved_at || null, updated_at: now }); } return event || null; }); },
  async deleteChannelAuthEventsByIds(ids: string[]) { return mutateStore((data) => { const idSet = new Set(ids); const before = data.channelAuthEvents.length; data.channelAuthEvents = data.channelAuthEvents.filter((e) => !idSet.has(e.id)); return { changes: before - data.channelAuthEvents.length }; }); },
  async deleteChannelAuthEventsForInstance(instanceId: string) { return mutateStore((data) => { data.channelAuthEvents = data.channelAuthEvents.filter((e) => e.instance_id !== instanceId); }); },


  async getSystemSetting(key: string) { return readStore().systemSettings[key] ?? null; },
  async setSystemSetting(key: string, value: string) { return mutateStore((data) => { data.systemSettings[key] = value; return { key, value, updated_at: nowIso() }; }); },
  async getSystemSettingBoolean(key: string, defaultValue = false) { const value = readStore().systemSettings[key]; return value == null ? defaultValue : ["true", "1", "yes"].includes(String(value).toLowerCase()); },
  async setSystemSettingBoolean(key: string, value: boolean) { return mutateStore((data) => { data.systemSettings[key] = String(value); return { key, value: String(value), updated_at: nowIso() }; }); },

  // Compatibility guard while legacy instance records are normalized to local execution.

  async createProvisioningBundle(input: any) { return createProvisioningBundle(input); },
  async getIdempotencyRecord(key: string) { return getIdempotencyRecord(key); },
  async deleteProvisioningRecords(instanceId: string) { return deleteProvisioningRecords(instanceId); },
  async listAllDeploymentTasks() { return listDeploymentTasksCore(); },
  async listPendingDeploymentTasks() { return listDeploymentTasksCore().filter((t: any) => ["queued", "retry_wait"].includes(t.status)); },
  async getDeploymentTaskById(id: string) { return getDeploymentTaskCore(id); },
  async createDeploymentTask(task: any) { return createDeploymentTaskCore(task); },
  async claimNextDeploymentTask(workerId: string, leaseSeconds: number) { return claimNextDeploymentTask(workerId, leaseSeconds); },
  async failExhaustedDeploymentTasks() { return failExhaustedDeploymentTasks(); },
  async claimDeploymentTask(_id: string) { return null; },
  async renewDeploymentLease(id: string, workerId: string, leaseSeconds: number) { return renewDeploymentLease(id, workerId, leaseSeconds); },
  async updateDeploymentTask(id: string, updates: any, workerId?: string) { return updateDeploymentTaskCore(id, updates, workerId); },
  async updateDeploymentTaskStatus(id: string, status: string, errorMsg?: string | null, errorCode?: string | null, errorDetail?: string | null) {
    const completed_at = ["success", "failed", "cancelled"].includes(status) ? nowIso() : null;
    const failed_at = status === "failed" ? nowIso() : null;
    return updateDeploymentTaskCore(id, { status, error_message: errorMsg || null, error_code: errorCode || null, error_detail: errorDetail || null, failed_at, completed_at });
  },
  async retryDeploymentTask(id: string) { return updateDeploymentTaskCore(id, { status: "retry_wait", next_retry_at: nowIso(), error_message: null, error_code: null, cancel_requested: false, completed_at: null }); },
  async cancelDeploymentTasksForInstance(instanceId: string) { return cancelDeploymentTasksForInstance(instanceId); },
  async releasePortReservation(instanceId: string) { return releasePortReservation(instanceId); },
  async reservePortForInstance(instanceId: string, candidatePorts: number[]) { return reservePortForInstance(instanceId, candidatePorts); },
  async getPortReservation(instanceId: string) { return getPortReservation(instanceId); },
  async createCleanupTask(instanceId: string, cleanupMode: "delete" | "archive" = "delete") { return createCleanupTaskCore(instanceId, cleanupMode); },
  async getLatestCleanupTaskForInstance(instanceId: string) { return getLatestCleanupTaskForInstance(instanceId); },
  async claimNextCleanupTask(workerId: string, leaseSeconds: number) { return claimNextCleanupTask(workerId, leaseSeconds); },
  async updateCleanupTask(id: string, status: string, errorCode?: string | null, errorMessage?: string | null, updates?: Record<string, any>) { return updateCleanupTaskCore(id, status, errorCode, errorMessage, updates); },
  async hasActiveDeploymentTasks() { return listDeploymentTasksCore().some((t: any) => ["queued", "deploying", "retry_wait"].includes(t.status)); },
};



