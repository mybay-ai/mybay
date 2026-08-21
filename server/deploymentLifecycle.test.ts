import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cancelDeploymentTasksForInstance,
  claimNextCleanupTask,
  claimNextDeploymentTask,
  closeLocalDatabase,
  createCleanupTaskCore,
  createProvisioningBundle,
  failExhaustedDeploymentTasks,
  getDeploymentTaskCore,
  getPortReservation,
  updateCleanupTaskCore,
  updateDeploymentTaskCore,
} from "./localStore";
import { classifyDockerError, isSimulatedDeploymentEnabled } from "./dockerErrorClassifier";

const testDir = path.resolve(process.cwd(), "data", "test-deployment-lifecycle");
let sqlitePath = path.join(testDir, "lifecycle.sqlite");

function cleanup() {
  closeLocalDatabase();
  fs.rmSync(testDir, { recursive: true, force: true });
}

function bundle(id: string, portCandidates: number[], key?: string, pathName = id) {
  return createProvisioningBundle({
    instance: { id, user_id: "user-1", path: pathName, status: "queued", config_json: "{}" },
    deploymentTask: { id: `task-${id}`, payload_json: { instance: { id }, secureData: {} }, created_by: "user-1" },
    idempotencyKey: key,
    requestHash: "same-hash",
    candidatePorts: portCandidates,
    maxActiveInstances: 20,
  });
}

describe("deployment lifecycle persistence", () => {
  beforeEach(() => {
    cleanup();
    sqlitePath = path.join(testDir, `lifecycle-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    process.env.MYBAY_SQLITE_PATH = path.relative(process.cwd(), sqlitePath);
    process.env.LOCAL_STORE_PATH = path.relative(process.cwd(), path.join(testDir, "no-legacy-store.json"));
  });
  afterEach(() => {
    cleanup();
    delete process.env.MYBAY_SQLITE_PATH;
    delete process.env.LOCAL_STORE_PATH;
  });

  it("keeps concurrent candidate ports unique at the database level", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) => Promise.resolve().then(() => bundle(`instance-${index}`, [10100, 10101, 10102, 10103, 10104, 10105, 10106, 10107]))));
    const ports = results.filter((result): result is Extract<typeof result, { kind: "created" }> => result.kind === "created").map((result) => result.port);
    expect(new Set(ports).size).toBe(8);
  }, 15_000);

  it("returns the same instance and task for an idempotent replay", () => {
    const first = bundle("instance-one", [10100], "request-key-123");
    const replay = bundle("instance-two", [10101], "request-key-123");
    expect(first.kind).toBe("created");
    expect(replay).toEqual({ kind: "replay", instanceId: "instance-one", deploymentTaskId: "task-instance-one" });
  });

  it("rejects the same idempotency key with a different payload hash", () => {
    bundle("instance-one", [10100], "request-key-123");
    const conflict = createProvisioningBundle({
      instance: { id: "instance-two", user_id: "user-1", path: "two", config_json: "{}" },
      deploymentTask: { id: "task-two", payload_json: {} },
      idempotencyKey: "request-key-123", requestHash: "different", candidatePorts: [10101], maxActiveInstances: 20,
    });
    expect(conflict).toEqual({ kind: "conflict", code: "IDEMPOTENCY_CONFLICT" });
  });

  it("enforces path uniqueness inside the same immediate transaction", () => {
    expect(bundle("one", [10100], undefined, "shared-path").kind).toBe("created");
    expect(bundle("two", [10101], undefined, "shared-path")).toEqual({ kind: "conflict", code: "PATH_CONFLICT" });
  });

  it("reclaims an expired deploying lease after worker restart", () => {
    bundle("recover", [10100]);
    const first = claimNextDeploymentTask("worker-one", 30);
    expect(first?.status).toBe("deploying");
    updateDeploymentTaskCore(first!.id, { lease_until: new Date(Date.now() - 1000).toISOString() }, "worker-one");
    const recovered = claimNextDeploymentTask("worker-two", 30);
    expect(recovered?.id).toBe(first?.id);
    expect(recovered?.worker_id).toBe("worker-two");
    expect(recovered?.attempt).toBe(2);
  });

  it("reclaims an expired cleanup lease after a cleanup worker crash", () => {
    const task = createCleanupTaskCore("cleanup-recover");
    const first = claimNextCleanupTask("cleanup-worker-one", 30);
    expect(first).toMatchObject({ id: task.id, status: "cleaning", attempt: 1 });
    updateCleanupTaskCore(first!.id, "cleaning", null, null, {
      worker_id: "cleanup-worker-one",
      lease_until: new Date(Date.now() - 1000).toISOString(),
      current_step: "container_cleanup",
    });
    const recovered = claimNextCleanupTask("cleanup-worker-two", 30);
    expect(recovered).toMatchObject({ id: task.id, status: "cleaning", worker_id: "cleanup-worker-two", attempt: 2 });
  });

  it("finalizes an exhausted stale deployment instead of leaving it deploying forever", () => {
    bundle("exhausted", [10100]);
    const claimed = claimNextDeploymentTask("worker-one", 30);
    updateDeploymentTaskCore(claimed!.id, {
      attempt: claimed!.max_attempts,
      lease_until: new Date(Date.now() - 1000).toISOString(),
    }, "worker-one");

    const finalized = failExhaustedDeploymentTasks();
    expect(finalized.map((task) => task.id)).toEqual([claimed!.id]);
    expect(getDeploymentTaskCore(claimed!.id)).toEqual(expect.objectContaining({
      status: "failed",
      error_code: "DEPLOYMENT_RETRY_EXHAUSTED",
      lease_until: null,
    }));
    expect(claimNextDeploymentTask("worker-two", 30)).toBeNull();
  });



  it("cancels a pending task before a worker can claim it", () => {
    bundle("delete-pending", [10100]);
    cancelDeploymentTasksForInstance("delete-pending");
    expect(getDeploymentTaskCore("task-delete-pending")?.status).toBe("cancelled");
    expect(claimNextDeploymentTask("worker", 30)).toBeNull();
    expect(getPortReservation("delete-pending")?.port).toBe(10100);
  });
});

describe("simulated deployment guard", () => {
  it("is disabled by default and outside tests", () => {
    expect(isSimulatedDeploymentEnabled({ NODE_ENV: "production", MYBAY_ENABLE_SIMULATED_DEPLOYMENT: "true" })).toBe(false);
    expect(isSimulatedDeploymentEnabled({ NODE_ENV: "test", MYBAY_ENABLE_SIMULATED_DEPLOYMENT: "false" })).toBe(false);
    expect(isSimulatedDeploymentEnabled({ NODE_ENV: "test", MYBAY_ENABLE_SIMULATED_DEPLOYMENT: "true" })).toBe(true);
  });
});
describe("Docker error classification", () => {
  it.each([
    "ports are not available: exposing port TCP 0.0.0.0:10100 -> Only one usage of each socket address is normally permitted",
    "port is already allocated",
    "Bind for 0.0.0.0:10100 failed programming external connectivity",
  ])("classifies Windows, macOS and Linux port conflicts", (message) => {
    expect(classifyDockerError(new Error(message)).code).toBe("PORT_CONFLICT");
  });

  it.each([
    "Cannot connect to the Docker daemon at unix:///var/run/docker.sock",
    "connect ENOENT //./pipe/docker_engine",
    "connect ECONNREFUSED /var/run/docker.sock",
  ])("classifies Docker Engine unavailability", (message) => {
    const result = classifyDockerError(new Error(message));
    expect(result.code).toBe("DOCKER_UNAVAILABLE");
    expect(result.message).toContain("Docker Engine is unavailable");
  });
});
