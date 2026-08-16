import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbAdapter } from "./db";
import { closeLocalDatabase, readStore } from "./localStore";
import { runSchedulerTick, stopSchedulerRunner } from "./schedulerRunner";
import { isInteractiveRunsEnabled } from "./utils/interactiveRuns";

const executeTaskInBackground = vi.hoisted(() => vi.fn());
vi.mock("./workers/taskRunner", () => ({ executeTaskInBackground }));

const sqlitePath = path.resolve(process.cwd(), "data", "test-scheduler.sqlite");
const legacyPath = path.resolve(process.cwd(), "data", "test-scheduler-legacy.json");
function cleanup() {
  stopSchedulerRunner();
  closeLocalDatabase();
  for (const target of [sqlitePath, `${sqlitePath}-wal`, `${sqlitePath}-shm`, `${sqlitePath}.migration-complete`, legacyPath]) {
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }
}

describe("scheduler runner on local SQLite", () => {
  beforeEach(async () => {
    cleanup();
    executeTaskInBackground.mockReset();
    executeTaskInBackground.mockResolvedValue(undefined);
    process.env.MYBAY_SQLITE_PATH = path.relative(process.cwd(), sqlitePath);
    process.env.LOCAL_STORE_PATH = path.relative(process.cwd(), legacyPath);
    await dbAdapter.createInstance({ id: "instance-1", user_id: "user-1", name: "Agent", status: "running", config_json: "{}" });
    const past = new Date(Date.now() - 60_000).toISOString();
    await dbAdapter.createScheduledJob({ id: "job-valid-1", owner_id: "user-1", instance_id: "instance-1", title: "Valid one", cron_expression: "*/5 * * * *", is_active: true, next_run_at: past });
    await dbAdapter.createScheduledJob({ id: "job-invalid", owner_id: "user-1", instance_id: "instance-1", title: "Broken", cron_expression: "not-a-cron", is_active: true, next_run_at: past });
    await dbAdapter.createScheduledJob({ id: "job-valid-2", owner_id: "user-1", instance_id: "instance-1", title: "Valid two", cron_expression: "*/10 * * * *", is_active: true, next_run_at: past });
    await dbAdapter.createScheduledJob({ id: "job-disabled", owner_id: "user-1", instance_id: "instance-1", title: "Disabled", cron_expression: "* * * * *", is_active: false, next_run_at: past });
  });

  afterEach(() => {
    cleanup();
    delete process.env.MYBAY_SQLITE_PATH;
    delete process.env.LOCAL_STORE_PATH;
    delete process.env.MYBAY_ASYNC_CHAT_RUNS_ENABLED;
  });

  it("dispatches due jobs once, skips disabled jobs, and isolates a bad job", async () => {
    await runSchedulerTick({ executeTasks: false });
    const firstTasks = readStore().tasks;
    expect(firstTasks.map((task) => task.input_payload.scheduled_job_id).sort()).toEqual(["job-valid-1", "job-valid-2"]);
    expect(readStore().deploymentEvents.some((event) => event.step === "scheduled_job_failed" && event.metadata?.job_id === "job-invalid")).toBe(true);
    expect(firstTasks.some((task) => task.input_payload.scheduled_job_id === "job-disabled")).toBe(false);
    expect(executeTaskInBackground).not.toHaveBeenCalled();

    closeLocalDatabase();
    await runSchedulerTick({ executeTasks: false });
    const afterRestart = readStore().tasks.filter((task) => ["job-valid-1", "job-valid-2"].includes(task.input_payload.scheduled_job_id));
    expect(afterRestart).toHaveLength(2);
  });

  it("keeps Interactive Agent enabled when scheduled execution is disabled", async () => {
    process.env.MYBAY_ASYNC_CHAT_RUNS_ENABLED = "true";

    await runSchedulerTick({ executeTasks: false });

    expect(isInteractiveRunsEnabled()).toBe(true);
    expect(executeTaskInBackground).not.toHaveBeenCalled();
  });

  it("keeps Interactive Agent disabled when scheduled execution is enabled", async () => {
    process.env.MYBAY_ASYNC_CHAT_RUNS_ENABLED = "false";

    await runSchedulerTick({ executeTasks: true });

    expect(isInteractiveRunsEnabled()).toBe(false);
    expect(executeTaskInBackground).toHaveBeenCalledTimes(2);
  });
});
