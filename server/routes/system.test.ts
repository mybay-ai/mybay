import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbAdapter } from "../db";
import { encrypt } from "../crypto";
import { loadLocalDatabaseOverviewData, resolveStoredCredentialApiKey } from "./system";

describe("saved credential LLM test resolution", () => {
  it("decrypts a stored credential before it is sent to the provider", () => {
    const plainApiKey = "sk-test-saved-credential";
    const storedKey = encrypt(plainApiKey);

    expect(storedKey).not.toBe(plainApiKey);
    expect(resolveStoredCredentialApiKey(storedKey)).toBe(plainApiKey);
  });
});

describe("system local database health", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockQueries(options: { instancesError?: boolean; usersError?: boolean; empty?: boolean } = {}) {
    if (options.instancesError) {
      vi.spyOn(dbAdapter, "getAllInstances").mockRejectedValue(new Error("instances failed"));
    } else {
      vi.spyOn(dbAdapter, "getAllInstances").mockResolvedValue(options.empty ? [] : [{ id: "instance-1" }] as any);
    }

    if (options.usersError) {
      vi.spyOn(dbAdapter, "getAdminUsersList").mockRejectedValue(new Error("users failed"));
    } else {
      vi.spyOn(dbAdapter, "getAdminUsersList").mockResolvedValue({
        users: options.empty ? [] : [{ id: "user-1" }],
        total: options.empty ? 0 : 1,
        page: 1,
        pageSize: 10000
      } as any);
    }
  }

  it("reports healthy when both local queries succeed", async () => {
    mockQueries();
    const result = await loadLocalDatabaseOverviewData();
    expect(result.databaseHealth).toEqual({ status: "healthy", details: "本地数据库正常" });
  });

  it("reports degraded when the instances query fails", async () => {
    mockQueries({ instancesError: true });
    const result = await loadLocalDatabaseOverviewData();
    expect(result.databaseHealth.status).toBe("degraded");
    expect(result.instancesError).toBe(true);
    expect(result.usersError).toBe(false);
  });

  it("reports degraded when the users query fails", async () => {
    mockQueries({ usersError: true });
    const result = await loadLocalDatabaseOverviewData();
    expect(result.databaseHealth.status).toBe("degraded");
    expect(result.instancesError).toBe(false);
    expect(result.usersError).toBe(true);
  });

  it("reports critical when both local queries fail", async () => {
    mockQueries({ instancesError: true, usersError: true });
    const result = await loadLocalDatabaseOverviewData();
    expect(result.databaseHealth).toEqual({ status: "critical", details: "本地数据库访问失败" });
  });

  it("treats successful empty arrays as healthy", async () => {
    mockQueries({ empty: true });
    const result = await loadLocalDatabaseOverviewData();
    expect(result.allInstances).toEqual([]);
    expect(result.usersList).toEqual([]);
    expect(result.databaseHealth.status).toBe("healthy");
  });
});
