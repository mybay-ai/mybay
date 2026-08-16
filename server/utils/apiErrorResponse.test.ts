import { describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../../shared/errorCodes";
import { createApiErrorPayload, sendApiError } from "./apiErrorResponse";

describe("API error response contract", () => {
  it("emits the stable contract while preserving the legacy error", () => {
    expect(createApiErrorPayload({
      code: ErrorCodes.INSTANCE_NOT_FOUND,
      legacyError: "mybay_instance_not_found",
      message: "Instance not found",
      params: { slug: "demo" },
      extra: { ready: false },
    })).toEqual({
      ready: false,
      code: ErrorCodes.INSTANCE_NOT_FOUND,
      params: { slug: "demo" },
      message: "Instance not found",
      error: "mybay_instance_not_found",
    });
  });

  it("sends the requested HTTP status and JSON payload", () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const response = { status } as any;

    sendApiError(response, { status: 401, code: ErrorCodes.INSTANCE_SESSION_UNAUTHORIZED });

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({
      code: ErrorCodes.INSTANCE_SESSION_UNAUTHORIZED,
      error: ErrorCodes.INSTANCE_SESSION_UNAUTHORIZED,
    });
  });
});