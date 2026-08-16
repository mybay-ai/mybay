import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  dbAdapter: {
    getInstanceById: vi.fn(),
    reservePortForInstance: vi.fn(),
    updateInstanceConfig: vi.fn(),
    updateDeploymentTask: vi.fn(),
    updateInstanceRecord: vi.fn(),
  },
  compensateDeployment: vi.fn(),
  createEvent: vi.fn(),
}));

vi.mock("../db", () => ({ dbAdapter: state.dbAdapter }));
vi.mock("../dockerDeployment", () => ({ executeDeployment: vi.fn() }));
vi.mock("../services/instanceCleanup", () => ({
  compensateDeployment: state.compensateDeployment,
  executeCleanupTask: vi.fn(),
}));
vi.mock("../repositories/deploymentEventsRepo", () => ({
  deploymentEventsRepo: { create: state.createEvent },
}));

import { schedulePortConflictRetry } from "./deployWorker";

describe("deployment worker port conflict recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.dbAdapter.getInstanceById.mockResolvedValue({
      id: "instance-1",
      user_id: "user-1",
      status: "deploying",
      desired_state: "running",
      config_json: JSON.stringify({ host_port: 10100, port: "10100" }),
    });
    state.dbAdapter.reservePortForInstance.mockResolvedValue(10101);
    state.dbAdapter.updateInstanceConfig.mockResolvedValue(undefined);
    state.dbAdapter.updateDeploymentTask.mockResolvedValue(undefined);
    state.dbAdapter.updateInstanceRecord.mockResolvedValue(undefined);
    state.compensateDeployment.mockResolvedValue(undefined);
    state.createEvent.mockResolvedValue(undefined);
  });

  it("releases the failed attempt, excludes the conflicted port and schedules retry", async () => {
    const task = {
      id: "task-1",
      instance_id: "instance-1",
      attempt: 1,
      max_attempts: 3,
      payload_json: { instance: { id: "instance-1" }, secureData: {} },
    };
    const io = { emit: vi.fn() } as any;

    await expect(schedulePortConflictRetry(task, { id: "instance-1" }, io, "port is already allocated")).resolves.toBe(true);

    expect(state.compensateDeployment).toHaveBeenCalled();
    const candidates = state.dbAdapter.reservePortForInstance.mock.calls[0][1] as number[];
    expect(candidates).not.toContain(10100);
    expect(candidates[0]).toBe(10101);
    expect(state.dbAdapter.updateDeploymentTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ status: "retry_wait", error_code: "PORT_CONFLICT", current_step: "queued" })
    );
    expect(state.dbAdapter.updateInstanceRecord).toHaveBeenCalledWith(
      "instance-1",
      expect.objectContaining({ status: "provisioning", desired_state: "running" })
    );
  });

  it("does not retry after the task has exhausted its attempt budget", async () => {
    const io = { emit: vi.fn() } as any;
    await expect(schedulePortConflictRetry({ attempt: 3, max_attempts: 3 }, { id: "instance-1" }, io, "conflict")).resolves.toBe(false);
    expect(state.compensateDeployment).not.toHaveBeenCalled();
  });
});
