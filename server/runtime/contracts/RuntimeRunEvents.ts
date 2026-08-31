import type { LocalFileChange } from "../../../shared/localRunFileEvidence";

export interface RuntimeRunEventTracker {
  activeToolFileMetadata?: Map<string, Record<string, string>>;
  completedFileSteps?: Map<string, LocalFileChange>;
  lastPartialOutput: string;
  sentSteps: Map<string, string>;
  activeToolIds: Map<string, string[]>;
}

export interface RuntimeRunEventTarget {
  id: string;
  status?: unknown;
  upstream_run_id?: unknown;
  partial_output?: unknown;
}

export type RuntimeRunTerminalOutcome =
  | {
      status: "completed";
      assistantContent: string;
      usage?: Record<string, unknown>;
      durationMs?: number | null;
    }
  | {
      status: "failed";
      errorCode: string;
      usage?: Record<string, unknown>;
      durationMs?: number | null;
    }
  | {
      status: "cancelled";
      errorCode: string;
      usage?: Record<string, unknown>;
      durationMs?: number | null;
    };

export interface RuntimeRunEventDependencies {
  addEvent(runId: string, event: string, data: string, ownerId?: string): void;
  completeTerminal(
    run: RuntimeRunEventTarget,
    outcome: RuntimeRunTerminalOutcome,
    upstreamRunId: string,
  ): Promise<boolean>;
  requestReconcile(): void;
  warn(message: string, detail: string): void;
  randomUUID(): string;
  now(): number;
}

export interface RuntimeRunEventController {
  get(runId: string): RuntimeRunEventTracker | undefined;
  getOrCreate(runId: string, initialPartialOutput?: unknown): RuntimeRunEventTracker;
  clear(runId: string): void;
  emitStep(runId: string, tracker: RuntimeRunEventTracker, step: unknown, ownerId?: string): void;
  handle(run: RuntimeRunEventTarget, event: unknown, upstreamRunId?: string): void;
  completeTerminalEvent(
    run: RuntimeRunEventTarget,
    event: unknown,
    upstreamRunId: string,
  ): Promise<boolean>;
}

/** Runtime-owned interpretation of native run events into MyBay lifecycle events. */
export interface RuntimeRunEventProvider {
  createController(dependencies: RuntimeRunEventDependencies): RuntimeRunEventController;
}
