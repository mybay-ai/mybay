import { describe, expect, it } from "vitest";
import { toHermesReasoningModelOptions } from "./HermesRunPreparation";

describe("HermesRunPreparationProvider", () => {
  it("maps UI reasoning choices to Hermes request model options", () => {
    expect(toHermesReasoningModelOptions("fast")).toEqual({
      reasoning: { enabled: true, effort: "low" },
      reasoning_effort: "low",
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
});
