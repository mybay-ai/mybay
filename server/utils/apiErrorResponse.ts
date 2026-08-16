import type { Response } from "express";
import type { ErrorCode } from "../../shared/errorCodes";

export interface ApiErrorPayload {
  code: ErrorCode;
  params?: Record<string, string | number | boolean>;
  message?: string;
  error?: string;
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
    error: legacyError || code,
  };
}

export function sendApiError(res: Response, options: SendApiErrorOptions) {
  const { status, ...payloadOptions } = options;
  return res.status(status).json(createApiErrorPayload(payloadOptions));
}