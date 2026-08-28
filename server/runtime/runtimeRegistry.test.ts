import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hermesRuntimeDriver } from "./adapters/hermes/HermesRuntimeDriver";
import {
  RuntimeRegistry,
  UnsupportedRuntimeTypeError,
  runtimeRegistry,
} from "./runtimeRegistry";

describe("server RuntimeRegistry", () => {
  it("registers the truthful Hermes execution boundary", () => {
    expect(runtimeRegistry.listRuntimeTypes()).toEqual(["hermes"]);
    expect(runtimeRegistry.get("hermes")).toBe(hermesRuntimeDriver);
    expect(runtimeRegistry.get().runs.request).toBeTypeOf("function");
    expect(runtimeRegistry.get().runs.streamEvents).toBeTypeOf("function");
    expect(Object.isFrozen(runtimeRegistry.get().capabilities)).toBe(true);
  });

  it("defaults legacy empty identity to Hermes and normalizes explicit identity", () => {
    expect(runtimeRegistry.resolveRuntimeType(undefined)).toBe("hermes");
    expect(runtimeRegistry.resolveRuntimeType("")).toBe("hermes");
    expect(runtimeRegistry.resolveRuntimeType(" HERMES ")).toBe("hermes");
  });

  it("fails closed for an unregistered Runtime instead of falling back to Hermes", () => {
    expect(() => runtimeRegistry.resolveRuntimeType("pi")).toThrowError(UnsupportedRuntimeTypeError);
    try {
      runtimeRegistry.resolveRuntimeType("pi");
    } catch (error) {
      expect(error).toMatchObject({ code: "UNSUPPORTED_RUNTIME_TYPE", requestedRuntimeType: "pi" });
    }
  });

  it("rejects duplicate registration and a missing default Driver", () => {
    expect(() => new RuntimeRegistry([hermesRuntimeDriver, hermesRuntimeDriver], "hermes"))
      .toThrow("registered more than once");
    expect(() => new RuntimeRegistry([], "hermes")).toThrow("Default Runtime is not registered");
  });

  it("accepts a new registered Runtime type without changing the Contract", () => {
    const testDriver = { ...hermesRuntimeDriver, runtimeType: "test-runtime" };
    const registry = new RuntimeRegistry([hermesRuntimeDriver, testDriver], "hermes");
    expect(registry.resolveRuntimeType(" TEST-RUNTIME ")).toBe("test-runtime");
    expect(registry.get("test-runtime")).toBe(testDriver);
  });

  it("routes Reconciler transport and capabilities through the Registry boundary", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "server/services/runsReconciler.ts"), "utf8");
    expect(source).toContain("runtimeRegistry.get(\"hermes\")");
    expect(source).toContain("runtimeDriver.runs.request");
    expect(source).toContain("runtimeDriver.runs.streamEvents");
    expect(source).toContain("runtimeDriver.capabilities");
    expect(source).not.toContain("requestHermesRunsAPI(");
    expect(source).not.toContain("streamHermesRunEventsAPI(");
  });
});
