import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hermesRuntimeDriver } from "./adapters/hermes/HermesRuntimeDriver";
import { piRuntimeDriver } from "./adapters/pi/PiRuntimeDriver";
import {
  RuntimeRegistry,
  UnsupportedRuntimeBindingError,
  UnsupportedRuntimeTypeError,
  runtimeRegistry,
} from "./runtimeRegistry";

describe("server RuntimeRegistry", () => {
  it("registers the truthful Hermes execution boundary", () => {
    expect(runtimeRegistry.listRuntimeTypes()).toEqual(["hermes", "pi"]);
    expect(runtimeRegistry.get("hermes")).toBe(hermesRuntimeDriver);
    expect(runtimeRegistry.listProviderKeys()).toEqual(["hermes-core", "pi-preview"]);
    expect(runtimeRegistry.get().runs.request).toBeTypeOf("function");
    expect(runtimeRegistry.get().runs.streamEvents).toBeTypeOf("function");
    expect(runtimeRegistry.get().preparation.createController).toBeTypeOf("function");
    expect(Object.isFrozen(runtimeRegistry.get().capabilities)).toBe(true);
  });

  it("defaults legacy empty identity to Hermes and normalizes explicit identity", () => {
    expect(runtimeRegistry.resolveRuntimeType(undefined)).toBe("hermes");
    expect(runtimeRegistry.resolveRuntimeType("")).toBe("hermes");
    expect(runtimeRegistry.resolveRuntimeType(" HERMES ")).toBe("hermes");
  });

  it("fails closed for an unregistered Runtime instead of falling back to Hermes", () => {
    expect(() => runtimeRegistry.resolveRuntimeType("unknown-runtime")).toThrowError(UnsupportedRuntimeTypeError);
    try {
      runtimeRegistry.resolveRuntimeType("unknown-runtime");
    } catch (error) {
      expect(error).toMatchObject({ code: "UNSUPPORTED_RUNTIME_TYPE", requestedRuntimeType: "unknown-runtime" });
    }
  });

  it("registers Pi as an explicit preview-only execution boundary", async () => {
    expect(runtimeRegistry.get("pi")).toBe(piRuntimeDriver);
    expect(runtimeRegistry.createBindingForInstance({ runtime_type: "pi" })).toEqual({
      runtimeType: "pi",
      providerKey: "pi-preview",
      contractVersion: 1,
    });
    expect(piRuntimeDriver.capabilities).toMatchObject({
      conversation: { modes: [] },
      cancellation: { supported: false },
      terminal: { observation: "unsupported" },
    });
    await expect(piRuntimeDriver.runs.request({
      instanceId: "preview",
      method: "POST",
      path: "/v1/runs",
    })).resolves.toEqual({ ok: false, statusCode: 501, error: "PI_RUNTIME_PREVIEW_ONLY" });
  });

  it("creates and resolves an immutable persisted Run Binding", () => {
    const binding = runtimeRegistry.createBindingForInstance(undefined);
    expect(binding).toEqual({ runtimeType: "hermes", providerKey: "hermes-core", contractVersion: 1 });
    expect(Object.isFrozen(binding)).toBe(true);
    expect(runtimeRegistry.resolveRunBinding({
      runtime_type: " HERMES ",
      runtime_provider_key: " HERMES-CORE ",
      runtime_contract_version: 1,
    })).toEqual(binding);
    expect(runtimeRegistry.getForBinding(binding)).toBe(hermesRuntimeDriver);
  });

  it.each([
    ["MISSING", {}],
    ["INVALID", { runtime_type: "hermes", runtime_provider_key: "hermes-core", runtime_contract_version: 0 }],
    ["UNREGISTERED", { runtime_type: "unknown-runtime", runtime_provider_key: "unknown-provider", runtime_contract_version: 1 }],
    ["INCONSISTENT", { runtime_type: "other", runtime_provider_key: "hermes-core", runtime_contract_version: 1 }],
  ])("fails closed for a %s persisted Run Binding", (reason, subject) => {
    expect(() => runtimeRegistry.resolveRunBinding(subject)).toThrowError(UnsupportedRuntimeBindingError);
    try {
      runtimeRegistry.resolveRunBinding(subject);
    } catch (error) {
      expect(error).toMatchObject({ code: "UNSUPPORTED_RUNTIME_BINDING", reason });
    }
  });

  it("rejects duplicate registration and a missing default Driver", () => {
    expect(() => new RuntimeRegistry([hermesRuntimeDriver, hermesRuntimeDriver], "hermes"))
      .toThrow("registered more than once");
    expect(() => new RuntimeRegistry([], "hermes")).toThrow("Default Runtime is not registered");
  });

  it("accepts a new registered Runtime type without changing the Contract", () => {
    const testDriver = { ...hermesRuntimeDriver, runtimeType: "test-runtime", providerKey: "test-core" };
    const registry = new RuntimeRegistry([hermesRuntimeDriver, testDriver], "hermes");
    expect(registry.resolveRuntimeType(" TEST-RUNTIME ")).toBe("test-runtime");
    expect(registry.get("test-runtime")).toBe(testDriver);
  });

  it("routes Reconciler transport, preparation, and capabilities through the Registry boundary", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "server/services/runsReconciler.ts"), "utf8");
    expect(source).toContain("runtimeRegistry.resolveRunBinding(run)");
    expect(source).toContain("runtimeRegistry.getForBinding");
    expect(source).toContain("driver.runs.request");
    expect(source).toContain("driver.runs.streamEvents");
    expect(source).toContain("driver.preparation.createController");
    expect(source).toContain("driver.execution.createController");
    expect(source).toContain("runPreparation.ensureSessionForConversation(run)");
    expect(source).toContain("runPreparation.buildRunPayload({");
    expect(source).toContain("runtimeDriver.capabilities");
    expect(source).not.toContain("requestHermesRunsAPI(");
    expect(source).not.toContain("streamHermesRunEventsAPI(");
    expect(source).not.toContain("runtimeRegistry.get(\"hermes\")");
    expect(source).not.toContain("createRunHermesSessionContextController");
    expect(source).not.toContain("buildHermesRunPayload(");
    expect(source).not.toContain("createHermesSessionBinding(");
  });
});
