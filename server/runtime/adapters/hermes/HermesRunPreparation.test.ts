import { describe, expect, it } from "vitest";
import { toHermesReasoningModelOptions } from "./HermesRunPreparation";

describe("HermesRunPreparationProvider", () => {
  it("maps UI reasoning choices to Hermes request model options", () => {
    expect(toHermesReasoningModelOptions("fast")).toEqual({
      reasoning: { enabled: false },
      reasoning_effort: "none",
      fast: true,
    });
    expect(toHermesReasoningModelOptions("balanced")).toEqual({
      reasoning: { enabled: true, effort: "medium" },
      reasoning_effort: "medium",
    });
    expect(toHermesReasoningModelOptions("deep")).toEqual({
      reasoning: { enabled: true, effort: "high" },
      reasoning_effort: "high",
    });
  });

  it("does not override the configured service tier outside explicit fast mode", () => {
    expect(toHermesReasoningModelOptions("balanced")).not.toHaveProperty("fast");
    expect(toHermesReasoningModelOptions("deep")).not.toHaveProperty("fast");
    expect(toHermesReasoningModelOptions(undefined)).not.toHaveProperty("fast");
  });
});
