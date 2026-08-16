import { describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../../shared/errorCodes";
import { extractApiErrorPayload, resolveApiErrorCode, translateApiError } from "./apiError";

describe("API error localization", () => {
  it("prefers a structured code over legacy fields", () => {
    expect(resolveApiErrorCode({
      code: ErrorCodes.INSTANCE_NOT_FOUND,
      error: "mybay_login_internal_error",
    })).toBe(ErrorCodes.INSTANCE_NOT_FOUND);
  });

  it("keeps legacy API responses compatible", () => {
    expect(resolveApiErrorCode({ error: "mybay_instance_not_found" })).toBe(ErrorCodes.INSTANCE_NOT_FOUND);
    expect(resolveApiErrorCode({ bridge: { reason: "invalid_credentials" } })).toBe(ErrorCodes.INVALID_INSTANCE_CREDENTIALS);
    expect(resolveApiErrorCode({ reason: "invalid_config" })).toBe(ErrorCodes.INSTANCE_CONFIG_INVALID);
  });

  it("translates with namespaced keys and interpolation params", () => {
    const t = vi.fn((key: string) => key);
    const result = translateApiError(t, {
      code: ErrorCodes.INSTANCE_AUTH_CHAIN_NOT_READY,
      params: { reason: "timeout" },
    });
    expect(result).toBe("errors:INSTANCE_AUTH_CHAIN_NOT_READY");
    expect(t).toHaveBeenCalledWith("errors:INSTANCE_AUTH_CHAIN_NOT_READY", { reason: "timeout" });
  });

  it("extracts nested HTTP client payloads", () => {
    expect(extractApiErrorPayload({ data: { code: ErrorCodes.INSTANCE_NOT_FOUND } })).toEqual({
      code: ErrorCodes.INSTANCE_NOT_FOUND,
    });
    expect(extractApiErrorPayload("bad response")).toBeNull();
  });
});