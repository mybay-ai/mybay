import { RUNTIME_DEFINITIONS } from "../../shared/runtimeCatalog";

export const PI_RUNTIME_RELEASE_CODE = "PI_RUNTIME_PREVIEW_ONLY";
export const UNSUPPORTED_RUNTIME_RELEASE_CODE = "UNSUPPORTED_RUNTIME_TYPE";

export function isPiRuntimeRequest(runtimeType: unknown): boolean {
  return typeof runtimeType === "string" && runtimeType.trim().toLowerCase() === "pi";
}

export function getRuntimeReleaseBoundary(runtimeType: unknown) {
  const normalized = runtimeType === undefined || runtimeType === null || runtimeType === ""
    ? "hermes"
    : typeof runtimeType === "string"
      ? runtimeType.trim().toLowerCase()
      : "";
  const definition = RUNTIME_DEFINITIONS.find((item) => item.runtime.type === normalized);
  if (!definition) {
    return {
      status: 400,
      code: UNSUPPORTED_RUNTIME_RELEASE_CODE,
      error: `Runtime '${String(runtimeType)}' is not registered.`,
    } as const;
  }
  if (definition.release.deploymentSupported) return null;
  return {
    status: 400,
    code: isPiRuntimeRequest(runtimeType) ? PI_RUNTIME_RELEASE_CODE : "RUNTIME_DEPLOYMENT_UNSUPPORTED",
    error: `${definition.displayName} is specification-only and cannot be deployed yet. Select an available Runtime instead.`,
  } as const;
}
