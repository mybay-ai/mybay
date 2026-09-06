import { describe, expect, it } from "vitest";
import {
  MANAGED_OPERATION_SYSTEM_POLICY,
  guardManagedOperation,
  managedOperationSystemPolicy,
} from "./managedOperationGuard";

describe("managed operation system policy", () => {
  it("keeps MyBay A2A credentials platform-managed and routes calls by configured peer identity", () => {
    expect(MANAGED_OPERATION_SYSTEM_POLICY).toContain("先调用 a2a_list");
    expect(MANAGED_OPERATION_SYSTEM_POLICY).toContain("Agent ID 或名称传给 a2a_call");
    expect(MANAGED_OPERATION_SYSTEM_POLICY).toContain("不要把 a2a_list 返回的内部 URL");
    expect(MANAGED_OPERATION_SYSTEM_POLICY).toContain("显式传入");
    expect(MANAGED_OPERATION_SYSTEM_POLICY).toContain("不要把 context_id 当作 task_id");
    expect(MANAGED_OPERATION_SYSTEM_POLICY).toContain("不要为了猜测未返回的任务 ID 或状态反复调用");
    expect(MANAGED_OPERATION_SYSTEM_POLICY).toContain("不要显示、比较、索取或要求用户手动编辑 Token");
    expect(MANAGED_OPERATION_SYSTEM_POLICY).toContain("不能据此判断 Token 已轮换或失效");
  });

  it("identifies Pi as Pi Runtime without inheriting Hermes identity wording", () => {
    const policy = managedOperationSystemPolicy("pi");
    expect(policy).toContain("你当前是 Pi Agent");
    expect(policy).not.toContain("Hermes Agent");
    expect(policy).toContain("Pi Agent 版本");
    expect(guardManagedOperation("帮我升级 Agent 版本", "pi").message).toContain("Pi Agent 版本升级");
  });
});
