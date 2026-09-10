import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  codex: vi.fn(),
  pi: vi.fn(),
  invalidateTarget: vi.fn(),
}));

vi.mock("./runtime/adapters/codex/CodexRuntimeReadiness", () => ({ probeCodexRuntimeReadiness: mocks.codex }));
vi.mock("./runtime/adapters/pi/PiRuntimeReadiness", () => ({ probePiRuntimeReadiness: mocks.pi }));
vi.mock("./utils/localInstanceTarget", () => ({ invalidateLocalInstanceTarget: mocks.invalidateTarget }));
vi.mock("./db", () => ({ dbAdapter: {} }));

import { buildUpgradeContainerEnvironment, probeManagedRuntimeUpgradeReadiness, refreshManagedRuntimeUpgradeTarget } from "./upgradeManager";

describe("managed Runtime upgrade readiness", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the Codex capability probe for a Codex upgrade", async () => {
    mocks.codex.mockResolvedValue({ gateway_ready: true, chat_ready: true });
    const instance = { id: "codex-instance", runtime_type: "codex" };
    await expect(probeManagedRuntimeUpgradeReadiness(instance)).resolves.toMatchObject({ chat_ready: true });
    expect(mocks.codex).toHaveBeenCalledWith(instance);
    expect(mocks.pi).not.toHaveBeenCalled();
  });

  it("keeps Pi on its own capability probe", async () => {
    mocks.pi.mockResolvedValue({ gateway_ready: true, chat_ready: true });
    const instance = { id: "pi-instance", runtime_type: "pi" };
    await probeManagedRuntimeUpgradeReadiness(instance);
    expect(mocks.pi).toHaveBeenCalledWith(instance);
    expect(mocks.codex).not.toHaveBeenCalled();
  });

  it("invalidates the cached target after a Runtime container is replaced", () => {
    refreshManagedRuntimeUpgradeTarget("codex-instance");
    expect(mocks.invalidateTarget).toHaveBeenCalledWith("codex-instance");
  });

  it("keeps one authoritative port when upgrading a Codex container", () => {
    expect(buildUpgradeContainerEnvironment(
      { runtime_type: "codex" },
      ["TZ=Asia/Shanghai", "PORT=8080", "GATEWAY_HEALTH_URL=http://stale"],
      9119,
    )).toEqual(["TZ=Asia/Shanghai", "PORT=9119"]);
  });
});
