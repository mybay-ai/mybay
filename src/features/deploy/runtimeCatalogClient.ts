import type { RuntimeDefinition } from "../../../shared/runtimeCatalog";
import { api } from "../../lib/api";

export interface RuntimeCatalogResponse {
  schemaVersion: 1;
  runtimes: RuntimeDefinition[];
}
function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseRuntimeCatalogResponse(value: unknown): RuntimeCatalogResponse {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.runtimes)) {
    throw new Error("RUNTIME_CATALOG_INVALID");
  }
  const seen = new Set<string>();
  for (const runtime of value.runtimes) {
    if (!isRecord(runtime)
      || !isRecord(runtime.runtime)
      || typeof runtime.runtime.type !== "string"
      || typeof runtime.displayName !== "string"
      || !isRecord(runtime.release)
      || typeof runtime.release.deploymentSupported !== "boolean"
      || !isRecord(runtime.capabilities)
      || !isRecord(runtime.lifecycle)) {
      throw new Error("RUNTIME_CATALOG_INVALID");
    }
    if (seen.has(runtime.runtime.type)) throw new Error("RUNTIME_CATALOG_DUPLICATE");
    seen.add(runtime.runtime.type);
    if (runtime.release.supportStatus === "spec-only" && runtime.release.deploymentSupported !== false) {
      throw new Error("RUNTIME_CATALOG_SPEC_ONLY_DEPLOYABLE");
    }
  }
  return value as RuntimeCatalogResponse;
}

export async function fetchRuntimeCatalog(signal?: AbortSignal): Promise<RuntimeCatalogResponse> {
  return parseRuntimeCatalogResponse(await api.get("/api/runtimes", { signal }));
}
