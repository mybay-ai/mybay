import { describe, expect, it, vi } from "vitest";
import type {
  RuntimeDriver,
  RuntimeRunEventDependencies,
  RuntimeRunExecutionDependencies,
  RuntimeRunPreparationDependencies,
} from "../contracts";
import { RuntimeRegistry } from "../runtimeRegistry";

interface RuntimeDriverContractExpectation {
  runtimeType: string;
  displayName: string;
  providerKey: string;
  contractVersion: number;
}

function createPreparationDependencies(): RuntimeRunPreparationDependencies {
  return {
    request: vi.fn(async () => ({ ok: false, statusCode: 503 })),
    bindConversationSessionId: vi.fn(async () => undefined),
    getConversationForSessionBinding: vi.fn(async () => null),
    logFallback: vi.fn(),
    deduplicateHistoryEnabled: () => false,
    systemPolicy: "contract-test-policy",
  };
}

function createEventDependencies(): RuntimeRunEventDependencies {
  return {
    addEvent: vi.fn(),
    completeTerminal: vi.fn(async () => false),
    requestReconcile: vi.fn(),
    warn: vi.fn(),
    randomUUID: () => "contract-test-id",
    now: () => 0,
  };
}

function createExecutionDependencies(): RuntimeRunExecutionDependencies {
  return {
    request: vi.fn(async () => ({ ok: false, statusCode: 503 })),
    emitStatus: vi.fn(),
    completeRun: vi.fn(async () => false),
    logOperation: vi.fn(),
    now: () => 0,
  };
}

/**
 * Shared admission contract for every server Runtime Driver.
 *
 * Adapter-specific behavior remains in each adapter's own tests. This suite
 * protects the common identity, capability, lifecycle, and persisted-binding
 * boundary that orchestration code relies on.
 */
export function defineRuntimeDriverContract(
  driver: RuntimeDriver,
  expected: RuntimeDriverContractExpectation,
): void {
  describe(`${expected.displayName} Runtime Driver contract`, () => {
    it("publishes an immutable, registry-safe identity", () => {
      expect(driver).toMatchObject(expected);
      expect(Object.isFrozen(driver)).toBe(true);
      expect(driver.runtimeType).toMatch(/^[a-z0-9][a-z0-9._-]{0,79}$/);
      expect(driver.providerKey).toMatch(/^[a-z0-9][a-z0-9._-]{0,79}$/);
      expect(driver.displayName.trim()).not.toBe("");
      expect(Number.isSafeInteger(driver.contractVersion)).toBe(true);
      expect(driver.contractVersion).toBeGreaterThanOrEqual(1);
    });

    it("publishes a valid immutable capability descriptor", () => {
      const capabilities = driver.capabilities;
      expect(Object.isFrozen(capabilities)).toBe(true);
      expect(Object.isFrozen(capabilities.conversation)).toBe(true);
      expect(Object.isFrozen(capabilities.conversation.modes)).toBe(true);
      expect(Object.isFrozen(capabilities.cancellation)).toBe(true);
      expect(Object.isFrozen(capabilities.terminal)).toBe(true);
      expect(Object.isFrozen(capabilities.interactions)).toBe(true);
      expect(new Set(capabilities.conversation.modes).size).toBe(
        capabilities.conversation.modes.length,
      );
      for (const mode of capabilities.conversation.modes) {
        expect(["streaming", "batch"]).toContain(mode);
      }
      expect(capabilities.cancellation.supported).toBeTypeOf("boolean");
      if (capabilities.cancellation.supported) {
        expect(["run", "turn"]).toContain(capabilities.cancellation.granularity);
      } else {
        expect(capabilities.cancellation.granularity).toBeUndefined();
      }
      expect(["status", "events", "unsupported"]).toContain(
        capabilities.terminal.observation,
      );
      expect(capabilities.interactions.approvals).toBeTypeOf("boolean");
      expect(capabilities.interactions.questions).toBeTypeOf("boolean");
    });

    it("exposes the complete lifecycle provider surface", () => {
      expect(driver.preparation.createController).toBeTypeOf("function");
      expect(driver.events.createController).toBeTypeOf("function");
      expect(driver.execution.createController).toBeTypeOf("function");
      expect(driver.runs.request).toBeTypeOf("function");
      expect(driver.runs.streamEvents).toBeTypeOf("function");

      const preparation = driver.preparation.createController(createPreparationDependencies());
      expect(preparation.createSessionBinding).toBeTypeOf("function");
      expect(preparation.ensureSessionForConversation).toBeTypeOf("function");
      expect(preparation.buildRunPayload).toBeTypeOf("function");

      const execution = driver.execution.createController(createExecutionDependencies());
      expect(execution.sessionCreateFailureCode).toMatch(/^[A-Z][A-Z0-9_]+$/);
      expect(execution.sessionRebindFailureCode).toMatch(/^[A-Z][A-Z0-9_]+$/);
      expect(execution.shouldPreferBatch).toBeTypeOf("function");
      expect(execution.isStaleSessionError).toBeTypeOf("function");
      expect(execution.shouldFallbackDispatch).toBeTypeOf("function");
      expect(execution.shouldFallbackStreaming).toBeTypeOf("function");
      expect(execution.staleSessionRecoveryEnabled).toBeTypeOf("function");
      expect(execution.executeBatch).toBeTypeOf("function");
    });

    it("isolates mutable event tracking between controller instances", () => {
      const first = driver.events.createController(createEventDependencies());
      const second = driver.events.createController(createEventDependencies());
      const tracker = first.getOrCreate("run-contract", 42);

      expect(tracker).toMatchObject({
        lastPartialOutput: "",
        sentSteps: new Map(),
        activeToolIds: new Map(),
      });
      expect(first.getOrCreate("run-contract", "ignored")).toBe(tracker);
      expect(second.get("run-contract")).toBeUndefined();
      expect(first.clear("run-contract")).toBe(true);
      expect(first.get("run-contract")).toBeUndefined();
    });

    it("round-trips an immutable persisted binding through the registry", () => {
      const registry = new RuntimeRegistry([driver], driver.runtimeType);
      const binding = registry.createBindingForInstance({ runtime_type: driver.runtimeType });

      expect(binding).toEqual({
        runtimeType: driver.runtimeType,
        providerKey: driver.providerKey,
        contractVersion: driver.contractVersion,
      });
      expect(Object.isFrozen(binding)).toBe(true);
      expect(registry.resolveRunBinding({
        runtime_type: driver.runtimeType.toUpperCase(),
        runtime_provider_key: driver.providerKey.toUpperCase(),
        runtime_contract_version: driver.contractVersion,
      })).toEqual(binding);
      expect(registry.getForBinding(binding)).toBe(driver);
    });
  });
}
