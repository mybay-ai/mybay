import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const dbAdapter = {
    getAllInstances: vi.fn(),
    updateInstanceConfig: vi.fn(),
    updateInstancePhysicalState: vi.fn(),
    updateInstanceVersionInfo: vi.fn(),
    updateInstanceRecord: vi.fn(),
    createCleanupTask: vi.fn()
  };
  const agentContainer = { start: vi.fn() };
  const traefikContainer = { inspect: vi.fn() };
  const docker = {
    listContainers: vi.fn(),
    getContainer: vi.fn((name: string) => name === "traefik" ? traefikContainer : agentContainer),
    listNetworks: vi.fn()
  };
  const cleanupInstanceResources = vi.fn();
  const compensateDeployment = vi.fn();
  return { dbAdapter, agentContainer, traefikContainer, docker, cleanupInstanceResources, compensateDeployment, traefik: false };
});

vi.mock("./db", () => ({ dbAdapter: state.dbAdapter }));
vi.mock("./lib/docker", () => ({ docker: state.docker }));
vi.mock("./infrastructure/traefik/traefikConfig", () => ({
  parseTraefikEnv: () => ({ isTraefik: state.traefik, traefikContainerName: "traefik" })
}));
vi.mock("./services/instanceCleanup", () => ({ cleanupInstanceResources: state.cleanupInstanceResources, compensateDeployment: state.compensateDeployment }));

import { startReconciler, stopReconciler } from "./reconciler";

describe("local Docker reconciler lifecycle", () => {
  beforeEach(() => {
    stopReconciler();
    state.traefik = false;
    vi.clearAllMocks();
    state.dbAdapter.updateInstanceConfig.mockResolvedValue(undefined);
    state.dbAdapter.updateInstancePhysicalState.mockResolvedValue(undefined);
    state.dbAdapter.updateInstanceVersionInfo.mockResolvedValue(undefined);
    state.dbAdapter.updateInstanceRecord.mockResolvedValue(undefined);
    state.dbAdapter.createCleanupTask.mockResolvedValue(undefined);
    state.cleanupInstanceResources.mockResolvedValue(undefined);
    state.compensateDeployment.mockResolvedValue(undefined);
    state.agentContainer.start.mockResolvedValue(undefined);
    state.docker.listNetworks.mockResolvedValue([]);
  });

  afterEach(() => {
    stopReconciler();
    vi.useRealTimers();
  });

  it("updates a running DB instance when its local container is stopped", async () => {
    state.dbAdapter.getAllInstances.mockResolvedValue([{
      id: "instance-1", status: "running", container_id: "container-1",
      container_name: "mybay-agent-instance-1", config_json: "{}"
    }]);
    state.docker.listContainers.mockResolvedValue([{
      Id: "container-1", Names: ["/mybay-agent-instance-1"], State: "exited", Created: 1, Labels: {}
    }]);

    await startReconciler(1000, { allowInTest: true, runStartupMaintenance: false });
    await vi.waitFor(() => expect(state.dbAdapter.updateInstancePhysicalState).toHaveBeenCalled());

    expect(state.agentContainer.start).toHaveBeenCalledTimes(1);
    expect(state.dbAdapter.updateInstancePhysicalState).toHaveBeenCalledWith(
      "instance-1",
      expect.objectContaining({ physical_status: "running", physical_error: null })
    );
  });

  it("degrades a running instance when its Docker container is missing", async () => {
    state.dbAdapter.getAllInstances.mockResolvedValue([{
      id: "missing", status: "running", desired_state: "running",
      container_name: "mybay-agent-missing", config_json: "{}"
    }]);
    state.docker.listContainers.mockResolvedValue([]);

    await startReconciler(1000, { allowInTest: true, runStartupMaintenance: false });
    await vi.waitFor(() => expect(state.dbAdapter.updateInstanceRecord).toHaveBeenCalled());

    expect(state.dbAdapter.updateInstanceRecord).toHaveBeenCalledWith(
      "missing",
      expect.objectContaining({ status: "degraded", health_status: "unhealthy", error_code: "CONTAINER_MISSING" })
    );
  });

  it("compensates Docker residue for a failed deployment", async () => {
    const instance = {
      id: "failed", status: "failed", desired_state: "running",
      container_name: "mybay-agent-failed", config_json: "{}"
    };
    state.dbAdapter.getAllInstances.mockResolvedValue([instance]);
    state.docker.listContainers.mockResolvedValue([{
      Id: "failed-container", Names: ["/mybay-agent-failed"], State: "exited", Created: 1, Labels: {}
    }]);

    await startReconciler(1000, { allowInTest: true, runStartupMaintenance: false });
    await vi.waitFor(() => expect(state.compensateDeployment).toHaveBeenCalledWith(instance));
  });

  it("requeues cleanup for an instance left in deleting", async () => {
    state.dbAdapter.getAllInstances.mockResolvedValue([{
      id: "deleting", status: "deleting", desired_state: "deleted",
      container_name: "mybay-agent-deleting", config_json: "{}"
    }]);
    state.docker.listContainers.mockResolvedValue([]);

    await startReconciler(1000, { allowInTest: true, runStartupMaintenance: false });
    await vi.waitFor(() => expect(state.dbAdapter.createCleanupTask).toHaveBeenCalledWith("deleting"));
  });


  it("contains a Traefik Docker inspect failure and continues later cycles", async () => {
    state.traefik = true;
    state.dbAdapter.getAllInstances.mockResolvedValue([]);
    state.docker.listContainers.mockResolvedValue([]);
    state.traefikContainer.inspect.mockRejectedValue(new Error("inspect failed"));

    await startReconciler(10, { allowInTest: true, runStartupMaintenance: false });
    await vi.waitFor(() => expect(state.traefikContainer.inspect.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(state.dbAdapter.getAllInstances.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("never overlaps reconcile cycles", async () => {
    vi.useFakeTimers();
    let releaseFirstCycle: ((instances: unknown[]) => void) | undefined;
    state.dbAdapter.getAllInstances.mockImplementationOnce(() => new Promise((resolve) => { releaseFirstCycle = resolve; }));

    await startReconciler(5, { allowInTest: true, runStartupMaintenance: false });
    await Promise.resolve();
    expect(state.dbAdapter.getAllInstances).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(25);
    expect(state.dbAdapter.getAllInstances).toHaveBeenCalledTimes(1);

    releaseFirstCycle?.([]);
    await Promise.resolve();
    await Promise.resolve();
  });
});
