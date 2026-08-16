import { dbAdapter } from "../db";

export interface Task {
  id?: string;
  owner_id: string;
  instance_id: string;
  template_id?: string;
  title: string;
  trigger_type?: string;
  prompt?: string;
  input_payload?: any;
  status?: string;
  result?: any;
  error?: string | null;
  token_usage?: any;
  retry_count?: number;
  max_retries?: number;
  started_at?: string | null;
  scheduled_fire_id?: string | null;
  idempotency_key?: string | null;
  finished_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export const tasksRepo = {
  async create(task: Task) {
    const payload = {
      owner_id: task.owner_id,
      instance_id: task.instance_id,
      template_id: task.template_id || null,
      title: task.title,
      trigger_type: task.trigger_type || "manual",
      prompt: task.prompt || null,
      input_payload: task.input_payload || {},
      scheduled_fire_id: task.scheduled_fire_id || null,
      idempotency_key: task.idempotency_key || null,
      status: task.status || "queued",
      created_at: new Date().toISOString()
    };

    return dbAdapter.createTaskRecord(payload);
  },

  async listByInstance(instanceId: string) {
    return dbAdapter.listTasksByInstance(instanceId);
  },

  async listByOwner(userId: string) {
    return dbAdapter.listTasksByOwner(userId);
  },

  async findById(id: string) {
    return dbAdapter.getTaskRecordById(id);
  },

  async update(id: string, updates: any) {
    return dbAdapter.updateTaskRecord(id, updates);
  }
};
