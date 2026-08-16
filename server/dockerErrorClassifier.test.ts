import { describe, expect, it } from "vitest";
import { classifyDockerError } from "./dockerErrorClassifier";

describe("Docker error callback envelope", () => {
  it("preserves the structured callback passed from Docker execution to the worker", () => {
    expect(classifyDockerError({
      error_code: "PORT_CONFLICT",
      error_message: "A different host port is required.",
      error_detail: "ports are not available: Only one usage of each socket address is normally permitted",
      retryable: true,
    })).toEqual({
      code: "PORT_CONFLICT",
      message: "A different host port is required.",
      detail: "ports are not available: Only one usage of each socket address is normally permitted",
      retryable: true,
    });
  });
});
