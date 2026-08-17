import { dbAdapter } from "../../db";
import { resolveInstanceInternalApiKey } from "../../utils/instanceInternalApiKey";
import { requestTraefikInternal } from "../../utils/traefikInternalRequest";
import { streamTraefikInternalSse } from "../../utils/traefikInternalSse";

export interface RunsRequestOptions {
  instanceId: string;
  method: string;
  path: string;
  body?: any;
  headers?: Record<string, string>;
  timeoutMs?: number;
  hermesSessionId?: string;
}

export interface RunsRequestResult {
  ok: boolean;
  statusCode: number;
  json?: any;
  error?: string;
}

function normalizeHeaderValue(value: unknown): string | undefined {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function sanitizeIdempotencyKey(value: unknown): string | undefined {
  const key = normalizeHeaderValue(value);
  if (!key || key.length > 256) return undefined;
  return /^[A-Za-z0-9._:-]+$/.test(key) ? key : undefined;
}

export function sanitizeRunsRequestHeaders(
  headers?: Record<string, string>
): Record<string, string> | undefined {
  const safeHeaders: Record<string, string> = {};
  const idempotencyKey = sanitizeIdempotencyKey(
    headers?.["Idempotency-Key"] || headers?.["idempotency-key"]
  );
  if (idempotencyKey) safeHeaders["Idempotency-Key"] = idempotencyKey;
  return Object.keys(safeHeaders).length > 0 ? safeHeaders : undefined;
}

export async function requestHermesRunsAPI(
  options: RunsRequestOptions
): Promise<RunsRequestResult> {
  const {
    instanceId,
    method,
    path,
    body,
    timeoutMs = 15000,
    headers: extraHeaders,
    hermesSessionId
  } = options;

  try {
    const instance = await dbAdapter.getInstanceById(instanceId);
    if (!instance) {
      return { ok: false, statusCode: 404, error: "INSTANCE_NOT_FOUND" };
    }

    const keyResolution = resolveInstanceInternalApiKey(instance);
    if (!keyResolution.ok || !keyResolution.apiKey) {
      return {
        ok: false,
        statusCode: 400,
        error: keyResolution.error || "HERMES_INTERNAL_API_KEY_MISSING"
      };
    }

    const response = await requestTraefikInternal({
      instanceId,
      method,
      path,
      apiKey: keyResolution.apiKey,
      body,
      timeoutMs,
      headers: sanitizeRunsRequestHeaders(extraHeaders),
      hermesSessionId
    });

    return {
      ok: response.ok,
      statusCode: response.statusCode,
      json: response.json,
      error: response.ok ? undefined : (response.error || response.rawBody)
    };
  } catch (error: any) {
    return {
      ok: false,
      statusCode: 500,
      error: error.message || "INTERNAL_RECONCILER_REQUEST_ERROR"
    };
  }
}

export async function streamHermesRunEventsAPI(
  instanceId: string,
  upstreamRunId: string,
  signal: AbortSignal,
  onChunk: (chunk: string) => void
): Promise<void> {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(upstreamRunId)) return;
  const instance = await dbAdapter.getInstanceById(instanceId);
  if (!instance) return;

  const keyResolution = resolveInstanceInternalApiKey(instance);
  if (!keyResolution.ok || !keyResolution.apiKey) return;

  await streamTraefikInternalSse({
    instanceId,
    path: `/v1/runs/${upstreamRunId}/events`,
    apiKey: keyResolution.apiKey,
    signal,
    onChunk
  });
}
