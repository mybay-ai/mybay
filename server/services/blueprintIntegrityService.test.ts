import { describe, expect, it } from "vitest";
import { summarizeBlueprintChildResults } from "./blueprintIntegrityService";

describe("local Blueprint integrity", () => {
  it("reports a complete Blueprint as success", () => {
    expect(summarizeBlueprintChildResults(2, [
      { templateId: "a", readiness: "ready", initializationFailed: false },
      { templateId: "b", readiness: "ready", initializationFailed: false }
    ])).toMatchObject({ successful: 2, failed: 0, status: "success" });
  });

  it("does not count configuration requirements as initialization failures", () => {
    expect(summarizeBlueprintChildResults(2, [
      { templateId: "a", readiness: "file_required", initializationFailed: false },
      { templateId: "b", readiness: "authorization_required", initializationFailed: false }
    ])).toMatchObject({ successful: 2, configRequired: 2, failed: 0, status: "config_required" });
  });

  it("reports missing or failed child initialization as degraded", () => {
    expect(summarizeBlueprintChildResults(3, [
      { templateId: "a", readiness: "ready", initializationFailed: false },
      { templateId: "b", readiness: "failed", initializationFailed: true }
    ])).toMatchObject({ successful: 1, failed: 2, status: "degraded" });
  });
});
