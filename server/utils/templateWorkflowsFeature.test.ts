import { describe, expect, it } from "vitest";
import { hasTemplateDeploymentPayload, isTemplateSchedulerEnabled, isTemplateWorkflowsEnabled } from "./templateWorkflowsFeature";

describe("optional template workflows feature", () => {
  it("is disabled by default and requires an explicit true value", () => {
    expect(isTemplateWorkflowsEnabled({})).toBe(false);
    expect(isTemplateWorkflowsEnabled({ TEMPLATE_CENTER_ENABLED: "false" })).toBe(false);
    expect(isTemplateWorkflowsEnabled({ TEMPLATE_CENTER_ENABLED: "TRUE" })).toBe(true);
  });

  it("only enables scheduling when both feature switches are enabled", () => {
    expect(isTemplateSchedulerEnabled({ TEMPLATE_CENTER_ENABLED: "true", SCHEDULER_RUNNER_ENABLED: "true" })).toBe(true);
    expect(isTemplateSchedulerEnabled({ TEMPLATE_CENTER_ENABLED: "false", SCHEDULER_RUNNER_ENABLED: "true" })).toBe(false);
    expect(isTemplateSchedulerEnabled({ TEMPLATE_CENTER_ENABLED: "true", SCHEDULER_RUNNER_ENABLED: "false" })).toBe(false);
  });

  it("detects template and Blueprint deployment payloads without blocking ordinary instances", () => {
    expect(hasTemplateDeploymentPayload({ name: "plain-agent", channel: "web" })).toBe(false);
    expect(hasTemplateDeploymentPayload({ template_id: "pdf-summary" })).toBe(true);
    expect(hasTemplateDeploymentPayload({ blueprint_snapshot: {} })).toBe(true);
  });
});
