import { describe, expect, it } from "vitest";
import en from "../src/locales/en/errors.json";
import zhCN from "../src/locales/zh-CN/errors.json";
import {
  ErrorCodes,
  instanceBridgeReasonToErrorCode,
  instanceReadinessReasonToErrorCode,
  isErrorCode,
} from "./errorCodes";

describe("shared error codes", () => {
  it("keeps every code translated in both locales", () => {
    const codes = Object.values(ErrorCodes).sort();
    expect(Object.keys(zhCN).sort()).toEqual(codes);
    expect(Object.keys(en).sort()).toEqual(codes);
  });

  it("recognizes only declared error codes", () => {
    expect(isErrorCode(ErrorCodes.INSTANCE_NOT_FOUND)).toBe(true);
    expect(isErrorCode("NOT_A_REAL_CODE")).toBe(false);
    expect(isErrorCode(null)).toBe(false);
  });

  it("maps readiness reasons to stable codes", () => {
    expect(instanceReadinessReasonToErrorCode("basic_auth_not_enabled")).toBe(ErrorCodes.INSTANCE_AUTH_NOT_CONFIGURED);
    expect(instanceReadinessReasonToErrorCode("missing_plain_instance_password")).toBe(ErrorCodes.INSTANCE_PASSWORD_UNAVAILABLE);
    expect(instanceReadinessReasonToErrorCode("invalid_config")).toBe(ErrorCodes.INSTANCE_CONFIG_INVALID);
    expect(instanceReadinessReasonToErrorCode("unexpected")).toBe(ErrorCodes.INSTANCE_AUTH_CHAIN_NOT_READY);
  });

  it("maps bridge reasons to stable codes", () => {
    expect(instanceBridgeReasonToErrorCode("invalid_credentials")).toBe(ErrorCodes.INVALID_INSTANCE_CREDENTIALS);
    expect(instanceBridgeReasonToErrorCode("missing_hermes_session_cookie")).toBe(ErrorCodes.INSTANCE_SESSION_COOKIE_MISSING);
    expect(instanceBridgeReasonToErrorCode("hermes_rate_limited")).toBe(ErrorCodes.INSTANCE_LOGIN_RATE_LIMITED);
    expect(instanceBridgeReasonToErrorCode("unexpected")).toBe(ErrorCodes.INSTANCE_SESSION_BRIDGE_FAILED);
  });
});