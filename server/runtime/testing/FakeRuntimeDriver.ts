import {
  defineRuntimeCapabilities,
  type RuntimeCapabilityDescriptor,
  type RuntimeDriver,
  type RuntimeRequestOptions,
  type RuntimeRequestResult,
  type RuntimeRunEventTracker,
} from "../contracts";

export interface FakeRuntimeDriverState {
  requests: RuntimeRequestOptions[];
  streams: Array<{ instanceId: string; upstreamRunId: string }>;
  ensuredSessions: Array<{ instance_id: string; conversation_id: string }>;
  payloads: Array<Record<string, unknown>>;
  dispatchResult: RuntimeRequestResult;
  probeResult: RuntimeRequestResult;
  stopResult: RuntimeRequestResult;
}

export interface FakeRuntimeDriverFixture {
  driver: RuntimeDriver;
  state: FakeRuntimeDriverState;
}

export function createFakeRuntimeDriver(options: {
  runtimeType?: string;
  providerKey?: string;
  capabilities?: RuntimeCapabilityDescriptor;
} = {}): FakeRuntimeDriverFixture {
  const runtimeType = options.runtimeType || "fake-runtime";
  const providerKey = options.providerKey || "fake-core";
  const state: FakeRuntimeDriverState = {
    requests: [],
    streams: [],
    ensuredSessions: [],
    payloads: [],
    dispatchResult: { ok: true, statusCode: 202, json: { run_id: "fake-upstream-1" } },
    probeResult: { ok: true, statusCode: 200, json: { status: "completed", output: "fake done" } },
    stopResult: { ok: true, statusCode: 202, json: { status: "cancelled" } },
  };
  const capabilities = defineRuntimeCapabilities(options.capabilities || {
    conversation: { modes: ["streaming"] },
    cancellation: { supported: true, granularity: "run" },
    terminal: { observation: "status" },
    interactions: { approvals: false, questions: false },
  });

  const driver: RuntimeDriver = Object.freeze({
    runtimeType,
    displayName: "Fake",
    providerKey,
    contractVersion: 1,
    capabilities,
    preparation: Object.freeze({
      createController: () => ({
        createSessionBinding: async () => ({ sessionId: "fake-session", state: "created" as const }),
        ensureSessionForConversation: async (target) => {
          state.ensuredSessions.push(target);
          return { sessionId: "fake-session", state: "existing" as const };
        },
        buildRunPayload: (payloadOptions) => {
          const payload = {
            runtime: runtimeType,
            session_id: payloadOptions.sessionBinding.sessionId,
            input: payloadOptions.userContent,
          };
          state.payloads.push(payload);
          return payload;
        },
      }),
    }),
    events: Object.freeze({
      createController: () => {
        const trackers = new Map<string, RuntimeRunEventTracker>();
        return {
          get: (runId: string) => trackers.get(runId),
          getOrCreate: (runId: string, initialPartialOutput: unknown = "") => {
            let tracker = trackers.get(runId);
            if (!tracker) {
              tracker = {
                lastPartialOutput: typeof initialPartialOutput === "string" ? initialPartialOutput : "",
                sentSteps: new Map(),
                activeToolIds: new Map(),
              };
              trackers.set(runId, tracker);
            }
            return tracker;
          },
          clear: (runId: string) => trackers.delete(runId),
          emitStep: () => {},
          handle: () => {},
          completeTerminalEvent: async () => false,
        };
      },
    }),
    execution: Object.freeze({
      createController: (dependencies) => ({
        sessionCreateFailureCode: "FAKE_SESSION_CREATE_FAILED",
        sessionRebindFailureCode: "FAKE_SESSION_REBIND_FAILED",
        shouldPreferBatch: () => false,
        isStaleSessionError: () => false,
        shouldFallbackDispatch: () => false,
        shouldFallbackStreaming: () => false,
        staleSessionRecoveryEnabled: () => false,
        executeBatch: async (run) => {
          await dependencies.completeRun(run.id, "failed", "", "FAKE_BATCH_UNSUPPORTED");
          return false;
        },
      }),
    }),
    runs: Object.freeze({
      request: async (requestOptions: RuntimeRequestOptions) => {
        state.requests.push(requestOptions);
        if (requestOptions.method === "POST" && requestOptions.path === "/v1/runs") {
          return state.dispatchResult;
        }
        if (requestOptions.method === "POST" && requestOptions.path.endsWith("/stop")) {
          return state.stopResult;
        }
        if (requestOptions.method === "GET" && requestOptions.path === "/v1/runs") {
          return { ok: true, statusCode: 200, json: { runs: [] } };
        }
        return state.probeResult;
      },
      streamEvents: async (instanceId: string, upstreamRunId: string) => {
        state.streams.push({ instanceId, upstreamRunId });
      },
    }),
  });

  return { driver, state };
}
