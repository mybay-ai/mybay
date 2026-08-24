import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const dbAdapter = {
    getAllInstances: vi.fn(),
    updateInstanceConfig: vi.fn(),
    updateInstancePhysicalState: vi.fn(),
    updateInstanceVersionInfo: vi.fn(),
    updateInstanceRecord: vi.fn(),
    createCleanupTask: vi.fn(),
    listAllDeploymentTasks: vi.fn()
  };
  const agentContainer = { start: vi.fn(), inspect: vi.fn() };
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
    state.agentContainer.inspect.mockResolvedValue({ State: { Status: "running" } });
    state.docker.listNetworks.mockResolvedValue([]);
    state.dbAdapter.listAllDeploymentTasks.mockResolvedValue([]);
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

  it("recovers a stale restarting transition after the control plane restarts", async () => {
    state.dbAdapter.getAllInstances.mockResolvedValue([{
      id: "stale-restart", status: "restarting", desired_state: "running",
      updated_at: "2020-01-01T00:00:00.000Z",
      container_name: "mybay-agent-stale-restart", config_json: "{}", metadata: {}
    }]);
    state.docker.listContainers.mockResolvedValue([{
      Id: "stale-container", Names: ["/mybay-agent-stale-restart"], State: "exited", Created: 1, Labels: {}
    }]);

    await startReconciler(1000, { allowInTest: true, runStartupMaintenance: false });
    await vi.waitFor(() => expect(state.agentContainer.start).toHaveBeenCalled());

    expect(state.dbAdapter.updateInstanceRecord).toHaveBeenCalledWith(
      "stale-restart",
      expect.objectContaining({ status: "gateway_starting", health_status: "checking" })
    );
    expect(state.dbAdapter.updateInstancePhysicalState).toHaveBeenCalledWith(
      "stale-restart",
      expect.objectContaining({ physical_status: "running", physical_error: null })
    );
  });

  it("does not take over a fresh or actively leased deployment transition", async () => {
    const fresh = {
      id: "fresh", status: "restarting", desired_state: "running",
      updated_at: new Date().toISOString(), container_name: "mybay-agent-fresh", config_json: "{}"
    };
    const leased = {
      id: "leased", status: "deploying", desired_state: "running",
      updated_at: "2020-01-01T00:00:00.000Z", container_name: "mybay-agent-leased", config_json: "{}"
    };
    state.dbAdapter.getAllInstances.mockResolvedValue([fresh, leased]);
    state.dbAdapter.listAllDeploymentTasks.mockResolvedValue([{ instance_id: "leased", status: "deploying" }]);
    state.docker.listContainers.mockResolvedValue([
      { Id: "fresh-id", Names: ["/mybay-agent-fresh"], State: "exited", Created: 1, Labels: {} },
      { Id: "leased-id", Names: ["/mybay-agent-leased"], State: "exited", Created: 1, Labels: {} },
    ]);

    await startReconciler(1000, { allowInTest: true, runStartupMaintenance: false });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(state.agentContainer.start).not.toHaveBeenCalled();
    expect(state.dbAdapter.updateInstanceRecord).not.toHaveBeenCalled();
  });

  it("does not report recovery until Docker verifies the container is running", async () => {
    state.dbAdapter.getAllInstances.mockResolvedValue([{
      id: "crash-loop", status: "running", desired_state: "running",
      container_name: "mybay-agent-crash-loop", config_json: "{}", metadata: {}
    }]);
    state.docker.listContainers.mockResolvedValue([{
      Id: "crash-loop-id", Names: ["/mybay-agent-crash-loop"], State: "exited", Created: 1, Labels: {}
    }]);
    state.agentContainer.inspect.mockResolvedValue({ State: { Status: "exited" } });

    await startReconciler(1000, { allowInTest: true, runStartupMaintenance: false });
    await vi.waitFor(() => expect(state.dbAdapter.updateInstancePhysicalState).toHaveBeenCalled());

    expect(state.dbAdapter.updateInstancePhysicalState).toHaveBeenCalledWith(
      "crash-loop",
      expect.objectContaining({
        physical_status: "exited",
        physical_error: expect.stringContaining("verified state is exited")
      })
    );
    expect(state.dbAdapter.updateInstanceVersionInfo).toHaveBeenCalledWith(
      "crash-loop",
      expect.objectContaining({ metadata: expect.objectContaining({ recovery: expect.objectContaining({ container_start_attempts: 1 }) }) })
    );
  });

  it("recovers an exited container while gateway readiness is still pending", async () => {
    state.dbAdapter.getAllInstances.mockResolvedValue([{
      id: "gateway-pending", status: "gateway_starting", desired_state: "running",
      container_name: "mybay-agent-gateway-pending", config_json: "{}", metadata: {}
    }]);
    state.docker.listContainers.mockResolvedValue([{
      Id: "gateway-pending-id", Names: ["/mybay-agent-gateway-pending"], State: "exited", Created: 1, Labels: {}
    }]);

    await startReconciler(1000, { allowInTest: true, runStartupMaintenance: false });
    await vi.waitFor(() => expect(state.agentContainer.start).toHaveBeenCalled());

    expect(state.dbAdapter.updateInstanceRecord).toHaveBeenCalledWith(
      "gateway-pending",
      expect.objectContaining({ status: "gateway_starting", health_status: "checking" })
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
