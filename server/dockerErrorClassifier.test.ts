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

  it("preserves unsupported-provider validation failures instead of reporting a container error", () => {
    expect(classifyDockerError({
      error_code: "PROVIDER_UNSUPPORTED",
      error_message: "Unsupported Hermes runtime provider: qwen.",
      error_detail: "Unsupported Hermes runtime provider: qwen.",
      retryable: false,
    })).toEqual({
      code: "PROVIDER_UNSUPPORTED",
      message: "Unsupported Hermes runtime provider: qwen.",
      detail: "Unsupported Hermes runtime provider: qwen.",
      retryable: false,
    });
  });
});
