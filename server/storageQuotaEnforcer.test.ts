import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const dbAdapter = {
    getAllInstances: vi.fn(),
    updateInstanceConfig: vi.fn(),
    updateInstanceStatus: vi.fn(),
    updateInstancePhysicalState: vi.fn()
  };
  const container = { inspect: vi.fn(), stop: vi.fn() };
  const docker = { getContainer: vi.fn(() => container) };
  const deploymentEventsRepo = { create: vi.fn() };
  const checkInstanceStorageQuota = vi.fn();
  return { dbAdapter, container, docker, deploymentEventsRepo, checkInstanceStorageQuota };
});

vi.mock("./db", () => ({ dbAdapter: state.dbAdapter }));
vi.mock("./lib/docker", () => ({ docker: state.docker }));
vi.mock("./repositories/deploymentEventsRepo", () => ({ deploymentEventsRepo: state.deploymentEventsRepo }));
vi.mock("./services/instances/instanceStorageQuotaService", () => ({ checkInstanceStorageQuota: state.checkInstanceStorageQuota }));
vi.mock("./utils/instances/instancePathUtils", () => ({ resolveInstanceDataDir: (instance: { id: string }) => "/data/" + instance.id }));

import { startStorageQuotaEnforcer, stopStorageQuotaEnforcer } from "./storageQuotaEnforcer";

const instance = (id: string) => ({
  id, user_id: "user-1", status: "running", archived: false,
  container_name: "mybay-agent-" + id, config_json: "{}", locale: "en"
});

describe("storage quota enforcer lifecycle", () => {
  beforeEach(() => {
    stopStorageQuotaEnforcer();
    vi.clearAllMocks();
    state.dbAdapter.updateInstanceConfig.mockResolvedValue(undefined);
    state.dbAdapter.updateInstanceStatus.mockResolvedValue(undefined);
    state.dbAdapter.updateInstancePhysicalState.mockResolvedValue(undefined);
    state.deploymentEventsRepo.create.mockResolvedValue(undefined);
    state.container.inspect.mockResolvedValue({ State: { Running: true }, SizeRw: 0 });
    state.container.stop.mockResolvedValue(undefined);
  });

  afterEach(() => {
    stopStorageQuotaEnforcer();
    vi.useRealTimers();
  });

  it("does not stop an instance below quota", async () => {
    state.dbAdapter.getAllInstances.mockResolvedValue([instance("safe")]);
    state.checkInstanceStorageQuota.mockResolvedValue({ storageUsedBytes: 50, storageLimitBytes: 100 });

    await startStorageQuotaEnforcer(1000, { allowInTest: true, startupDelayMs: 0 });
    await vi.waitFor(() => expect(state.checkInstanceStorageQuota).toHaveBeenCalledTimes(1));

    expect(state.container.stop).not.toHaveBeenCalled();
    expect(state.dbAdapter.updateInstanceConfig).not.toHaveBeenCalled();
  });

  it("stops and marks an instance that exceeds quota", async () => {
    state.dbAdapter.getAllInstances.mockResolvedValue([instance("full")]);
    state.checkInstanceStorageQuota.mockResolvedValue({ storageUsedBytes: 100, storageLimitBytes: 100 });

    await startStorageQuotaEnforcer(1000, { allowInTest: true, startupDelayMs: 0 });
    await vi.waitFor(() => expect(state.container.stop).toHaveBeenCalledTimes(1));

    expect(state.dbAdapter.updateInstanceConfig).toHaveBeenCalledWith("full", expect.stringContaining('"storageExceeded":true'));
    expect(state.dbAdapter.updateInstancePhysicalState).toHaveBeenCalledWith(
      "full", expect.objectContaining({ physical_status: "storage_exceeded" })
    );
  });

  it("continues scanning after one instance quota check fails", async () => {
    state.dbAdapter.getAllInstances.mockResolvedValue([instance("broken"), instance("healthy")]);
    state.checkInstanceStorageQuota
      .mockRejectedValueOnce(new Error("disk read failed"))
      .mockResolvedValueOnce({ storageUsedBytes: 20, storageLimitBytes: 100 });

    await startStorageQuotaEnforcer(1000, { allowInTest: true, startupDelayMs: 0 });
    await vi.waitFor(() => expect(state.checkInstanceStorageQuota).toHaveBeenCalledTimes(2));

    expect(state.checkInstanceStorageQuota.mock.calls[1][0].id).toBe("healthy");
  });

  it("never overlaps quota scan cycles", async () => {
    vi.useFakeTimers();
    state.dbAdapter.getAllInstances.mockResolvedValue([instance("slow")]);
    let releaseQuota: ((value: { storageUsedBytes: number; storageLimitBytes: number }) => void) | undefined;
    state.checkInstanceStorageQuota.mockImplementationOnce(() => new Promise((resolve) => { releaseQuota = resolve; }));

    await startStorageQuotaEnforcer(5, { allowInTest: true, startupDelayMs: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(state.checkInstanceStorageQuota).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(25);
    expect(state.checkInstanceStorageQuota).toHaveBeenCalledTimes(1);

    releaseQuota?.({ storageUsedBytes: 1, storageLimitBytes: 100 });
    await Promise.resolve();
    await Promise.resolve();
  });
});
