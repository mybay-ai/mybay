import { describe, expect, it } from "vitest";
import { translateToolStepLabel } from "./toolStepI18n";

const t = (key: string) => `translated:${key}`;

describe("translateToolStepLabel", () => {
  it("translates known Agent event titles", () => {
    expect(translateToolStepLabel(t, "Agent task queued")).toBe("translated:chatWorkspace.toolStepAgentTaskQueued");
    expect(translateToolStepLabel(t, "Deployment worker claimed the Agent task")).toBe("translated:chatWorkspace.toolStepDeploymentWorkerClaimed");
    expect(translateToolStepLabel(t, "Connecting to Pi Agent runtime")).toBe("translated:chatWorkspace.toolStepConnectingRuntime");
    expect(translateToolStepLabel(t, "Connected to Codex Agent runtime")).toBe("translated:chatWorkspace.toolStepConnectedRuntime");
  });

  it("translates stored chatWorkspace keys", () => {
    expect(translateToolStepLabel(t, "chatWorkspace.toolStepCompleted")).toBe("translated:chatWorkspace.toolStepCompleted");
  });

  it("preserves dynamic tool labels", () => {
    expect(translateToolStepLabel(t, "Custom local tool")).toBe("Custom local tool");
  });
});
