import { RUNTIME_DEFINITIONS, type RuntimeDefinition } from "../../../shared/runtimeCatalog";

export function getDeployRuntimeDisplayName(runtimeType: unknown): string {
  const normalizedRuntimeType = String(runtimeType || "hermes").trim().toLowerCase();
  return RUNTIME_DEFINITIONS.find((definition) => definition.runtime.type === normalizedRuntimeType)?.displayName
    || normalizedRuntimeType;
}

export function getDeployRuntimePresentationKeys(
  definition: Pick<RuntimeDefinition, "release" | "runtime">,
) {
  const runtimeType = definition.runtime.type;
  return {
    certificationKey: `runtimePresentation.certification.${definition.release.certificationLevel}`,
    surfaceKey: `runtimePresentation.surface.${runtimeType}`,
    descriptionKey: `runtimePresentation.description.${runtimeType}`,
  } as const;
}
