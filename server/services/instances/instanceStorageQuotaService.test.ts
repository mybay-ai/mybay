import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { getDirectorySizeBytes } from "../../utils/storageQuota";
import { checkInstanceStorageQuota } from "./instanceStorageQuotaService";

vi.mock("../../utils/storageQuota", () => ({ getDirectorySizeBytes: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

describe("upload storage scan budget", () => {
  it("uses a longer explicit budget without changing existing callers", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.mocked(getDirectorySizeBytes).mockResolvedValue(512);
    const instance = { config_json: { limitsDiskMb: 1 } };
    const result = await checkInstanceStorageQuota(instance, "/root", { timeoutMs: 45_000 });
    expect(getDirectorySizeBytes).toHaveBeenLastCalledWith("/root", 45_000);
    expect(result.storageUsedBytes).toBe(512);
    expect(result.storageStatus).toBe("normal");
    await checkInstanceStorageQuota(instance, "/root");
    expect(getDirectorySizeBytes).toHaveBeenLastCalledWith("/root", undefined);
  });

  it("keeps a failed scan unknown instead of reporting zero usage", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(getDirectorySizeBytes).mockRejectedValue(new Error("Storage check timed out"));
    expect(await checkInstanceStorageQuota({}, "/root", { timeoutMs: 45_000 })).toMatchObject({
      storageUsedBytes: null, storageStatus: "unknown", storageUsagePercent: null,
    });
  });
});
