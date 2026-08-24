import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { checkRecentSessionsForAppliedModel } from "./modelProbe";

const tempRoots: string[] = [];

function createStateDatabase(instanceId: string, rows: Array<Record<string, unknown>>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mybay-model-session-"));
  tempRoots.push(root);
  const instanceDir = path.join(root, instanceId);
  fs.mkdirSync(instanceDir, { recursive: true });
  const database = new DatabaseSync(path.join(instanceDir, "state.db"));
  database.exec(`
    CREATE TABLE sessions (
      source TEXT,
      model TEXT,
      billing_provider TEXT,
      api_call_count INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      last_activity_at REAL,
      started_at REAL
    )
  `);
  const insert = database.prepare(`
    INSERT INTO sessions (
      source, model, billing_provider, api_call_count,
      input_tokens, output_tokens, last_activity_at, started_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of rows) {
    insert.run(
      String(row.source || "feishu"),
      String(row.model || ""),
      String(row.provider || ""),
      Number(row.apiCallCount || 0),
      Number(row.inputTokens || 0),
      Number(row.outputTokens || 0),
      Number(row.lastActivityAt || Date.now() / 1000),
      Number(row.startedAt || Date.now() / 1000),
    );
  }
  database.close();
  return root;
}

afterEach(() => {
  delete process.env.MYBAY_INSTANCE_DATA_ROOT;
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("checkRecentSessionsForAppliedModel", () => {
  it("uses a real Feishu model call as runtime verification evidence", () => {
    const instanceId = "instance-1";
    process.env.MYBAY_INSTANCE_DATA_ROOT = createStateDatabase(instanceId, [{
      model: "deepseek-v4-flash",
      provider: "deepseek",
      apiCallCount: 1,
      inputTokens: 120,
      outputTokens: 30,
    }]);

    expect(checkRecentSessionsForAppliedModel(instanceId, "deepseek", "deepseek-v4-flash")).toMatchObject({
      success: true,
      sessionCount: 1,
      lastSession: {
        source: "feishu",
        model: "deepseek-v4-flash",
        provider: "deepseek",
        api_call_count: 1,
      },
    });
  });

  it("does not accept a session for a different model", () => {
    const instanceId = "instance-2";
    process.env.MYBAY_INSTANCE_DATA_ROOT = createStateDatabase(instanceId, [{
      model: "different-model",
      provider: "deepseek",
      apiCallCount: 1,
    }]);

    expect(checkRecentSessionsForAppliedModel(instanceId, "deepseek", "deepseek-v4-flash").success).toBe(false);
  });

  it("ignores sessions that never called a model", () => {
    const instanceId = "instance-3";
    process.env.MYBAY_INSTANCE_DATA_ROOT = createStateDatabase(instanceId, [{
      model: "deepseek-v4-flash",
      provider: "deepseek",
      apiCallCount: 0,
    }]);

    expect(checkRecentSessionsForAppliedModel(instanceId, "deepseek", "deepseek-v4-flash").success).toBe(false);
  });
});
