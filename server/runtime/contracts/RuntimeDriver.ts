import type { RuntimeCapabilityDescriptor } from "./RuntimeCapabilities";
import type { RuntimeRunPreparationProvider } from "./RuntimeRunPreparation";
import type { RuntimeRunEventProvider } from "./RuntimeRunEvents";
import type { RuntimeRunExecutionProvider } from "./RuntimeRunExecution";

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

export interface RuntimeRequestResult<TJson = any> {
  ok: boolean;
  statusCode: number;
  json?: TJson;
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
  readonly displayName: string;
  readonly providerKey: string;
  readonly contractVersion: number;
  readonly capabilities: RuntimeCapabilityDescriptor;
  readonly preparation: RuntimeRunPreparationProvider;
  readonly events: RuntimeRunEventProvider;
  readonly execution: RuntimeRunExecutionProvider;
  readonly runs: RuntimeRunTransport;
}
