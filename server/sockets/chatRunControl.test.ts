import { describe, expect, it, vi } from "vitest";

import { handleChatRunStopControl } from "./chatRunControl";

function dependencies() {
  return {
    getUserById: vi.fn(async () => ({ id: "user-1", status: "active" })),
    resolveInstance: vi.fn(async () => ({ ok: true, actor: { kind: "user", id: "user-1" }, ownerId: "user-1", instance: { id: "instance-1" } })),
    resolveRun: vi.fn(async ({ instance }: any) => ({ ...instance, ok: true, conversation: { id: "conversation-1" }, run: { id: "00000000-0000-4000-8000-000000000001" } })),
    requestStop: vi.fn(async () => ({ status: "stop_requested", run_status: "stopping" })),
    requestReconcile: vi.fn(),
  };
}

describe("chat run socket control", () => {
  it("records an authorized stop and wakes the reconciler", async () => {
    const deps = dependencies();
    await expect(handleChatRunStopControl("user-1", {
      instanceId: "instance-1",
      runId: "00000000-0000-4000-8000-000000000001",
    }, deps as any)).resolves.toEqual({ success: true, status: "stopping" });
    expect(deps.requestStop).toHaveBeenCalledOnce();
    expect(deps.requestReconcile).toHaveBeenCalledOnce();
  });

  it("rejects invalid identifiers before reading protected data", async () => {
    const deps = dependencies();
    await expect(handleChatRunStopControl("user-1", { instanceId: "../bad", runId: "bad" }, deps as any))
      .resolves.toEqual({ success: false, error: "INVALID_REQUEST" });
    expect(deps.getUserById).not.toHaveBeenCalled();
  });

  it("returns an existing terminal status without waking the reconciler", async () => {
    const deps = dependencies();
    deps.requestStop.mockResolvedValue({ status: "already_terminal", run_status: "cancelled" });
    await expect(handleChatRunStopControl("user-1", {
      instanceId: "instance-1",
      runId: "00000000-0000-4000-8000-000000000001",
    }, deps as any)).resolves.toEqual({ success: true, status: "cancelled" });
    expect(deps.requestReconcile).not.toHaveBeenCalled();
  });
});
