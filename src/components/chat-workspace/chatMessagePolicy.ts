import type { ChatMessage } from "../../lib/chatWorkspaceState";

const CONCURRENCY_TAKEOVER_ERRORS = new Set([
  "TOO_MANY_CONCURRENT_RUNS",
  "CONCURRENT_REQUEST",
  "CONCURRENT_RUN",
  "ACTIVE_RUN_EXISTS",
  "RUN_ALREADY_ACTIVE"
]);

const STOPPED_RUN_ERROR_CODES = new Set([
  "RUN_STOPPED",
  "CANCELLED_UPSTREAM",
  "CANCELLED_BY_USER",
  "RUN_CANCELLED"
]);

export function getBackendErrorCode(err: any): string {
  return String(err?.data?.error || err?.code || err?.message || "");
}

export function isConcurrencyTakeoverError(err: any): boolean {
  const code = getBackendErrorCode(err);
  if (CONCURRENCY_TAKEOVER_ERRORS.has(code)) return true;
  if ((err?.status === 409 || err?.status === 429) && /CONCURRENT|ACTIVE_RUN|RUNNING|TOO_MANY/i.test(code)) return true;
  if ((err?.status === 409 || err?.status === 429) && /concurrent|active run|running async/i.test(String(err?.data?.message || ""))) return true;
  return false;
}

export function isRetryableRunCreationError(err: any): boolean {
  const status = Number(err?.status);
  if (!Number.isFinite(status) || status <= 0) return true;
  return status === 408 || status === 425 || status === 502 || status === 503 || status === 504 || status >= 500;
}

export function isConcurrencyTakeoverCode(code?: string | null): boolean {
  return !!code && (CONCURRENCY_TAKEOVER_ERRORS.has(code) || /CONCURRENT|ACTIVE_RUN|RUN_ALREADY|TOO_MANY/i.test(code));
}

export function isStoppedRunCode(code?: string | null): boolean {
  return !!code && STOPPED_RUN_ERROR_CODES.has(code);
}

export function normalizeStoredMessageStatus(status?: string, errorCode?: string | null): ChatMessage["status"] {
  if ((status === "failed" || status === "cancelled") && isStoppedRunCode(errorCode)) return "stopped";
  if (status === "failed" && isConcurrencyTakeoverCode(errorCode)) return "superseded";
  return (status as ChatMessage["status"]) || "completed";
}

export function normalizeStoredMessageError(
  status?: string,
  errorCode?: string | null,
  errorMessage?: string | null
): string | undefined {
  if ((status === "failed" || status === "cancelled") && isStoppedRunCode(errorCode)) return undefined;
  if (status === "failed" && isConcurrencyTakeoverCode(errorCode)) return undefined;
  if (status === "failed") return errorMessage || errorCode || undefined;
  return errorMessage || undefined;
}

