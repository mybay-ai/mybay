import {
  ErrorCodes,
  instanceBridgeReasonToErrorCode,
  instanceReadinessReasonToErrorCode,
  isErrorCode,
  type ErrorCode,
} from "../../shared/errorCodes";

export interface ApiErrorPayloadLike {
  code?: unknown;
  params?: Record<string, string | number | boolean>;
  message?: unknown;
  error?: unknown;
  reason?: unknown;
  bridge?: { reason?: unknown };
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

const LEGACY_ERROR_CODES: Record<string, ErrorCode> = {
  mybay_instance_not_found: ErrorCodes.INSTANCE_NOT_FOUND,
  mybay_invalid_config_json: ErrorCodes.INSTANCE_CONFIG_INVALID,
  mybay_login_internal_error: ErrorCodes.INSTANCE_LOGIN_INTERNAL_ERROR,
  internal_error: ErrorCodes.INSTANCE_READINESS_INTERNAL_ERROR,
  bridge_failed: ErrorCodes.INSTANCE_SESSION_BRIDGE_FAILED,
};

export function resolveApiErrorCode(payload: ApiErrorPayloadLike | null | undefined, fallback: ErrorCode = ErrorCodes.UNKNOWN): ErrorCode {
  if (isErrorCode(payload?.code)) return payload.code;
  if (typeof payload?.error === "string" && LEGACY_ERROR_CODES[payload.error]) return LEGACY_ERROR_CODES[payload.error];
  const bridgeReason = typeof payload?.bridge?.reason === "string" ? payload.bridge.reason : "";
  if (bridgeReason) return instanceBridgeReasonToErrorCode(bridgeReason);
  if (typeof payload?.reason === "string") return instanceReadinessReasonToErrorCode(payload.reason);
  return fallback;
}

export function translateApiError(t: Translate, payload: ApiErrorPayloadLike | null | undefined, fallback: ErrorCode = ErrorCodes.UNKNOWN): string {
  const code = resolveApiErrorCode(payload, fallback);
  return t(`errors:${code}`, payload?.params || {});
}

export function extractApiErrorPayload(value: unknown): ApiErrorPayloadLike | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.data && typeof candidate.data === "object") return candidate.data as ApiErrorPayloadLike;
  return candidate as ApiErrorPayloadLike;
}