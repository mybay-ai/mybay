import { describe, expect, it } from "vitest";
import { parseRuntimeCatalogResponse } from "./runtimeCatalogClient";

const runtime = (overrides: Record<string, unknown> = {}) => ({
  displayName: "Hermes Agent",
  runtime: { type: "hermes", image: "nousresearch/hermes-agent", tag: "latest", internalPort: 9119 },
  release: { supportStatus: "available", certificationLevel: "experimental", deploymentSupported: true },
  capabilities: {},
  lifecycle: {},
  ...overrides,
});
describe("Runtime catalog client", () => {
  it("accepts a versioned catalog", () => {
    expect(parseRuntimeCatalogResponse({ schemaVersion: 1, runtimes: [runtime()] }).runtimes)
      .toHaveLength(1);
  });

  it("fails closed for malformed, duplicate, or deployable spec-only entries", () => {
    expect(() => parseRuntimeCatalogResponse({ schemaVersion: 2, runtimes: [] })).toThrow("RUNTIME_CATALOG_INVALID");
    expect(() => parseRuntimeCatalogResponse({ schemaVersion: 1, runtimes: [runtime(), runtime()] }))
      .toThrow("RUNTIME_CATALOG_DUPLICATE");
    expect(() => parseRuntimeCatalogResponse({
      schemaVersion: 1,
      runtimes: [runtime({ release: { supportStatus: "spec-only", certificationLevel: "spec-only", deploymentSupported: true } })],
    })).toThrow("RUNTIME_CATALOG_SPEC_ONLY_DEPLOYABLE");
  });
});
