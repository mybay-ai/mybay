import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  dbAdapter: {
    getInstanceById: vi.fn(),
    releasePortReservation: vi.fn(),
    updateCleanupTask: vi.fn(),
    updateInstanceRecord: vi.fn(),
    archiveInstance: vi.fn(),
  },
  cleanOldContainersOfInstance: vi.fn(),
  createEvent: vi.fn(),
  listScheduledJobs: vi.fn(),
  updateScheduledJob: vi.fn(),
}));

vi.mock("../db", () => ({ dbAdapter: state.dbAdapter }));
vi.mock("dockerode", () => ({ default: class { getNetwork() { return { remove: vi.fn().mockResolvedValue(undefined) }; } } }));

vi.mock("../dockerDeployment", () => ({
  cleanOldContainersOfInstance: state.cleanOldContainersOfInstance,
  disconnectControlPlaneFromNetwork: vi.fn().mockResolvedValue(undefined),
  disconnectTraefikFromNetwork: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../repositories/deploymentEventsRepo", () => ({
  deploymentEventsRepo: { create: state.createEvent },
}));
vi.mock("../repositories/scheduledJobsRepo", () => ({
  scheduledJobsRepo: { listByInstance: state.listScheduledJobs, update: state.updateScheduledJob },
}));

import { compensateDeployment, executeCleanupTask } from "./instanceCleanup";

describe("cleanup task recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MYBAY_CLEANUP_MAX_ATTEMPTS = "3";
    state.dbAdapter.getInstanceById.mockResolvedValue({
      id: "instance-1",
      user_id: "user-1",
      status: "deleting",
      desired_state: "deleted",
      config_json: "{}",
    });
    state.dbAdapter.updateCleanupTask.mockResolvedValue(undefined);
    state.createEvent.mockResolvedValue(undefined);
    state.dbAdapter.updateInstanceRecord.mockResolvedValue(undefined);
    state.cleanOldContainersOfInstance.mockRejectedValue(new Error("temporary Docker cleanup failure"));
    state.listScheduledJobs.mockResolvedValue([]);
  });

  it("requeues a transient cleanup failure before the attempt budget is exhausted", async () => {
    await expect(executeCleanupTask({ id: "cleanup-1", instance_id: "instance-1", attempt: 1 })).resolves.toBeUndefined();
    expect(state.dbAdapter.updateCleanupTask).toHaveBeenCalledWith(
      "cleanup-1", "retry_wait", "CLEANUP_RETRY_SCHEDULED", "temporary Docker cleanup failure",
      expect.objectContaining({ error_detail: "temporary Docker cleanup failure", current_step: "cleanup_retry_wait", next_retry_at: expect.any(String) })
    );
    expect(state.dbAdapter.updateInstanceRecord).toHaveBeenCalledWith(
      "instance-1", expect.objectContaining({ status: "deleting" })
    );
  });

  it("marks cleanup and instance failed after the final attempt", async () => {
    await expect(executeCleanupTask({ id: "cleanup-1", instance_id: "instance-1", attempt: 3 }))
      .rejects.toThrow("temporary Docker cleanup failure");
    expect(state.dbAdapter.updateCleanupTask).toHaveBeenCalledWith(
      "cleanup-1", "failed", "CLEANUP_FAILED", "temporary Docker cleanup failure",
      expect.objectContaining({ error_detail: "temporary Docker cleanup failure", current_step: "cleanup_failed" })
    );
    expect(state.dbAdapter.updateInstanceRecord).toHaveBeenCalledWith(
      "instance-1", expect.objectContaining({ status: "cleanup_failed" })
    );
  });

  it("deployment compensation preserves active scheduled jobs", async () => {
    state.cleanOldContainersOfInstance.mockResolvedValue(undefined);
    state.listScheduledJobs.mockResolvedValue([{ id: "job-1", is_active: true }]);
    await compensateDeployment({
      id: "instance-1", user_id: "user-1", config_json: "{}",
    });
    expect(state.listScheduledJobs).not.toHaveBeenCalled();
    expect(state.updateScheduledJob).not.toHaveBeenCalled();
  });

  it("recovers an archive task and archives only after runtime cleanup succeeds", async () => {
    state.cleanOldContainersOfInstance.mockResolvedValue(undefined);
    state.dbAdapter.archiveInstance.mockResolvedValue(undefined);
    await executeCleanupTask({
      id: "cleanup-archive-1", instance_id: "instance-1",
      cleanup_mode: "archive", attempt: 2,
    });
    expect(state.dbAdapter.archiveInstance).toHaveBeenCalledWith("instance-1");
    expect(state.dbAdapter.updateCleanupTask).toHaveBeenCalledWith(
      "cleanup-archive-1", "success", null, null,
      { current_step: "archived" },
    );
    expect(state.dbAdapter.updateInstanceRecord).toHaveBeenCalledWith(
      "instance-1", expect.objectContaining({ desired_state: "archived" }),
    );
  });
});
