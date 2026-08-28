import type { RuntimeCapabilityDescriptor } from "./RuntimeCapabilities";
import type { RuntimeRunPreparationProvider } from "./RuntimeRunPreparation";

export type RuntimeType = string;

export interface RuntimeRequestOptions {
  instanceId: string;
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  sessionId?: string;
}

export interface RuntimeRequestResult {
  ok: boolean;
  statusCode: number;
  json?: unknown;
  error?: string;
}

export interface RuntimeRunTransport {
  request(options: RuntimeRequestOptions): Promise<RuntimeRequestResult>;
  streamEvents(
    instanceId: string,
    upstreamRunId: string,
    signal: AbortSignal,
    onChunk: (chunk: string) => void,
  ): Promise<void>;
}

/**
 * Minimal server-side Runtime contract.
 *
 * Keep this consumer-driven: lifecycle orchestration remains authoritative in
 * MyBay services until a second Runtime proves another shared boundary.
 */
export interface RuntimeDriver {
  readonly runtimeType: RuntimeType;
  readonly providerKey: string;
  readonly contractVersion: number;
  readonly capabilities: RuntimeCapabilityDescriptor;
  readonly preparation: RuntimeRunPreparationProvider;
  readonly runs: RuntimeRunTransport;
}
