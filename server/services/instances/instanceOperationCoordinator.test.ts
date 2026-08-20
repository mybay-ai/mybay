import { describe, expect, it } from "vitest";
import { InstanceOperationCoordinator } from "./instanceOperationCoordinator";

describe("InstanceOperationCoordinator", () => {
  it("rejects a second destructive operation for the same instance", () => {
    const coordinator = new InstanceOperationCoordinator(() => 1_000, () => "lease-one");
    const first = coordinator.tryAcquire("instance-1", "redeploy");
    const second = coordinator.tryAcquire("instance-1", "restart");

    expect(first.acquired).toBe(true);
    expect(second).toEqual({
      acquired: false,
      active: expect.objectContaining({ instanceId: "instance-1", operation: "redeploy", token: "lease-one" }),
    });
  });

  it("allows operations for different instances", () => {
    let token = 0;
    const coordinator = new InstanceOperationCoordinator(() => 1_000, () => `lease-${++token}`);

    expect(coordinator.tryAcquire("instance-1", "restart").acquired).toBe(true);
    expect(coordinator.tryAcquire("instance-2", "restart").acquired).toBe(true);
  });

  it("only releases the matching lease token", () => {
    const coordinator = new InstanceOperationCoordinator(() => 1_000, () => "lease-one");
    const result = coordinator.tryAcquire("instance-1", "stop");
    if (!result.acquired) throw new Error("expected lease acquisition");

    expect(coordinator.release({ instanceId: "instance-1", token: "stale-token" })).toBe(false);
    expect(coordinator.getActive("instance-1")).not.toBeNull();
    expect(coordinator.release(result.lease)).toBe(true);
    expect(coordinator.getActive("instance-1")).toBeNull();
  });

  it("expires abandoned operations so a local restart cannot block forever", () => {
    let now = 1_000;
    let token = 0;
    const coordinator = new InstanceOperationCoordinator(() => now, () => `lease-${++token}`);

    expect(coordinator.tryAcquire("instance-1", "redeploy", 500).acquired).toBe(true);
    now = 1_501;

    const replacement = coordinator.tryAcquire("instance-1", "restart", 500);
    expect(replacement.acquired).toBe(true);
    if (replacement.acquired) expect(replacement.lease.token).toBe("lease-2");
  });
});
