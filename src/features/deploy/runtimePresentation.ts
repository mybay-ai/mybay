import { RUNTIME_DEFINITIONS } from "../../../shared/runtimeCatalog";

export function getDeployRuntimeDisplayName(runtimeType: unknown): string {
  const normalizedRuntimeType = String(runtimeType || "hermes").trim().toLowerCase();
  return RUNTIME_DEFINITIONS.find((definition) => definition.runtime.type === normalizedRuntimeType)?.displayName
    || normalizedRuntimeType;
}
