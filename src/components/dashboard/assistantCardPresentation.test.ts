import { describe, expect, it } from "vitest";
import type { AgentInstance } from "../../types";
import { getAssistantCardPresentation } from "./assistantCardPresentation";

const instance = (overrides: Partial<AgentInstance> = {}) => ({
  id: "agent-1",
  name: "Agent 1",
  path: "/tmp/agent-1",
  status: "running",
  url: "http://agent.localhost",
  createdAt: new Date(0).toISOString(),
  ...overrides,
} as AgentInstance);

describe("assistant card presentation", () => {
  it("allows chat for a healthy running instance", () => {
    expect(getAssistantCardPresentation(instance())).toMatchObject({
      canChat: true,
      canOpenFiles: true,
      needsAttention: false,
    });
  });

  it.each([
    [{ status: "failed", deployment_error: "boom" }, "deployment"],
    [{ model_config_status: "mismatched" }, "model"],
    [{ physical_error: "disconnected" }, "state"],
    [{ status: "partial_running" }, "runtime"],
  ] as const)("routes degraded instances to diagnostics: %s", (overrides, issue) => {
    expect(getAssistantCardPresentation(instance(overrides as Partial<AgentInstance>))).toMatchObject({
      canChat: false,
      needsAttention: true,
      issue,
    });
  });

  it("keeps files available for stopped instances while chat stays disabled", () => {
    expect(getAssistantCardPresentation(instance({ status: "stopped" }))).toMatchObject({
      canChat: false,
      canOpenFiles: true,
    });
  });
});
