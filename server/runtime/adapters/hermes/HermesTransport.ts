import type { RuntimeRequestOptions, RuntimeRequestResult } from "../../contracts";
import {
  requestInternalRuntimeAPI,
  sanitizeRuntimeIdempotencyKey,
  sanitizeRuntimeRequestHeaders,
  streamInternalRuntimeEventsAPI,
} from "../../transports/InternalRuntimeTransport";

export type RunsRequestOptions = RuntimeRequestOptions;
export type RunsRequestResult = RuntimeRequestResult;

export const sanitizeIdempotencyKey = sanitizeRuntimeIdempotencyKey;

export const sanitizeRunsRequestHeaders = sanitizeRuntimeRequestHeaders;

export async function requestHermesRunsAPI(
  options: RunsRequestOptions
): Promise<RunsRequestResult> {
  return requestInternalRuntimeAPI(options);
}

export async function streamHermesRunEventsAPI(
  instanceId: string,
  upstreamRunId: string,
  signal: AbortSignal,
  onChunk: (chunk: string) => void
): Promise<void> {
  return streamInternalRuntimeEventsAPI(instanceId, upstreamRunId, signal, onChunk);
}
