import { describe, expect, it, vi } from "vitest";
import { getCleanupStatusPresentation } from "./instanceStatus";

describe("cleanup UI status presentation", () => {
  it("maps persisted cleanup steps to user-friendly text", () => {
    expect(getCleanupStatusPresentation({
      status: "deleting",
      cleanupStatus: "cleaning",
      cleanupStep: "cleaning_network",
    } as any)).toEqual({ text: "正在清理 Docker 网络" });
  });

  it("shows sanitized cleanup errors and the persisted retry time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T00:00:00.000Z"));
    expect(getCleanupStatusPresentation({
      status: "deleting",
      cleanupStatus: "retry_wait",
      cleanupStep: "cleanup_retry_wait",
      cleanupErrorMessage: "Docker network is still in use",
      cleanupNextRetryAt: "2026-08-14T00:00:30.000Z",
    } as any)).toEqual({
      text: "清理失败，等待自动重试（约 30 秒后）",
      detail: "Docker network is still in use",
    });
    vi.useRealTimers();
  });
});
