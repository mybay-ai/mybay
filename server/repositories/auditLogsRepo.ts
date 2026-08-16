import { dbAdapter } from "../db";

export const auditLogsRepo = {
  async create(log: { instance_id: string | null; action: string; user_id: string | null; timestamp: string; details: string; actor_type?: string }) {
    const isSystem = log.user_id === "system" || log.instance_id === "system";
    await dbAdapter.insertAuditLog({
      ...log,
      instance_id: log.instance_id === "system" ? null : log.instance_id,
      user_id: log.user_id === "system" ? null : log.user_id,
      owner_id: log.user_id === "system" ? null : log.user_id,
      actor_type: log.actor_type || (isSystem ? "system" : "user"),
      timestamp: log.timestamp || new Date().toISOString()
    });
  },

  async listByInstance(instanceId: string) {
    const logs = await dbAdapter.getAuditLogs(instanceId);
    return logs.slice().sort((a: any, b: any) => String(b.timestamp || "").localeCompare(String(a.timestamp || ""))).slice(0, 100);
  },

  async deleteByInstance(instanceId: string) {
    await dbAdapter.deleteAuditLogsForInstance(instanceId);
  }
};
