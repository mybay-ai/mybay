import { dbAdapter } from "../db";

export interface DeploymentTask {
  id: string;
  instance_id: string;
  status: 'pending' | 'deploying' | 'success' | 'failed' | 'retrying';
  payload_json?: any;
  error_message?: string | null;
  retry_count: number;
  created_by?: string | null;
  locked_at?: string | null;
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export const deploymentTasksRepo = {
  async listAll() {
    const tasks = await dbAdapter.listAllDeploymentTasks();
    return Promise.all((tasks || []).map(async (task: any) => {
      const instance = task.instance_id ? await dbAdapter.getInstanceById(task.instance_id).catch(() => null) : null;
      return { ...task, instances: instance ? { name: instance.name } : null };
    }));
  },

  async listPending() {
    return (await dbAdapter.listPendingDeploymentTasks()) as DeploymentTask[];
  },

  async findById(id: string) {
    return (await dbAdapter.getDeploymentTaskById(id)) as DeploymentTask | null;
  },

  async create(task: Partial<DeploymentTask>) {
    const id = task.id || `task-${Math.random().toString(36).substring(2, 11)}`;
    const now = new Date().toISOString();
    const payload = {
      id,
      instance_id: task.instance_id,
      status: task.status || 'pending',
      payload_json: task.payload_json || {},
      error_message: task.error_message || null,
      retry_count: task.retry_count || 0,
      created_by: task.created_by || null,
      created_at: task.created_at || now,
      updated_at: now
    };
    return (await dbAdapter.createDeploymentTask(payload)) as DeploymentTask;
  },

  async claimTask(id: string) {
    return (await dbAdapter.claimDeploymentTask(id)) as DeploymentTask | null;
  },

  async updateStatus(id: string, status: string, errorMsg?: string | null) {
    return (await dbAdapter.updateDeploymentTaskStatus(id, status, errorMsg)) as DeploymentTask | null;
  },

  async retryTask(id: string) {
    const task = await this.findById(id);
    if (!task) throw new Error("Task not found");
    return (await dbAdapter.retryDeploymentTask(id)) as DeploymentTask | null;
  },

  async hasActiveTasks(): Promise<boolean> {
    return dbAdapter.hasActiveDeploymentTasks();
  }
};
