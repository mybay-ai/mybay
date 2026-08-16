import { describe, expect, it } from "vitest";
import { isDeploymentSuccessful } from "./deploymentUiState";

describe("deployment success UI gate", () => {
  it("does not show success for a 202 queued deployment", () => {
    expect(isDeploymentSuccessful({ status: "queued", instanceStatus: "provisioning" })).toBe(false);
  });

  it("does not show success when the task succeeded but the instance is not running", () => {
    expect(isDeploymentSuccessful({ status: "success", instanceStatus: "provisioning" })).toBe(false);
  });

  it("shows success only after task success and instance running", () => {
    expect(isDeploymentSuccessful({ status: "success", instanceStatus: "running" })).toBe(true);
  });
});
