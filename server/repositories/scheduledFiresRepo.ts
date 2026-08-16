import { dbAdapter } from "../db";

export const scheduledFiresRepo = {
  claim(jobId: string, fireAt: string, snapshot: any) {
    return dbAdapter.claimScheduledFire(jobId, fireAt, snapshot);
  },
  listRecoverable(limit = 20) {
    return dbAdapter.listRecoverableScheduledFires(limit);
  },
  findTask(fireId: string) {
    return dbAdapter.findTaskByScheduledFireId(fireId);
  },
  markDispatched(id: string, taskId: string) {
    return dbAdapter.updateScheduledFire(id, { status: "dispatched", task_id: taskId, last_error: null });
  },
  markCompleted(id: string) {
    return dbAdapter.updateScheduledFire(id, { status: "completed", last_error: null });
  },
  markFailed(id: string, error: string) {
    return dbAdapter.updateScheduledFire(id, { status: "failed", last_error: error });
  }
};
