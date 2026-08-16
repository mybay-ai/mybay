import { dbAdapter } from "../db";

export interface ScheduledJob {
  id?: string;
  owner_id: string;
  instance_id: string;
  template_id?: string;
  title: string;
  cron_expression: string;
  prompt?: string;
  is_active?: boolean;
  input_payload?: any;
  next_run_at?: string;
  last_run_at?: string;
  created_at?: string;
  updated_at?: string;
}

export const scheduledJobsRepo = {
  async create(job: ScheduledJob) {
    const payload = {
      owner_id: job.owner_id,
      instance_id: job.instance_id,
      template_id: job.template_id || null,
      title: job.title,
      cron_expression: job.cron_expression,
      prompt: job.prompt || null,
      is_active: job.is_active ?? true,
      input_payload: job.input_payload || {},
      next_run_at: job.next_run_at || null,
      last_run_at: job.last_run_at || null,
      created_at: job.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    return dbAdapter.createScheduledJob(payload);
  },

  async listByInstance(instanceId: string) {
    return dbAdapter.listScheduledJobsByInstance(instanceId);
  },

  async listByOwner(userId: string) {
    return dbAdapter.listScheduledJobsByOwner(userId);
  },

  async listDue(now: string, limit = 20) {
    return dbAdapter.listDueScheduledJobs(now, limit);
  },

  async findById(id: string) {
    return dbAdapter.getScheduledJobById(id);
  },

  async update(id: string, updates: any) {
    return dbAdapter.updateScheduledJob(id, updates);
  }
};
