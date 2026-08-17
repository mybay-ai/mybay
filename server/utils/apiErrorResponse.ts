import type { Response } from "express";
import type { ErrorCode } from "../../shared/errorCodes";

export interface ApiErrorPayload {
  code: ErrorCode;
  params?: Record<string, string | number | boolean>;
  message?: string;
  error?: string;
  requestId?: string;
}

export interface SendApiErrorOptions extends ApiErrorPayload {
  status: number;
  legacyError?: string;
  extra?: Record<string, unknown>;
}

export function createApiErrorPayload(options: Omit<SendApiErrorOptions, "status">): ApiErrorPayload & Record<string, unknown> {
  const { code, params, message, legacyError, extra } = options;
  return {
    ...(extra || {}),
    code,
    ...(params ? { params } : {}),
    ...(message ? { message } : {}),
    ...(options.requestId ? { requestId: options.requestId } : {}),
    error: legacyError || code,
  };
}

export function sendApiError(res: Response, options: SendApiErrorOptions) {
  const { status, ...payloadOptions } = options;
  const responseRequestId = typeof res.locals?.requestId === "string"
    ? res.locals.requestId
    : String(res.getHeader("x-request-id") || "").trim();
  return res.status(status).json(createApiErrorPayload({
    ...payloadOptions,
    requestId: responseRequestId || payloadOptions.requestId || undefined,
  }));
}
