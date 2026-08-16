export const PI_RUNTIME_RELEASE_CODE = "PI_RUNTIME_PREVIEW_ONLY";

export function isPiRuntimeRequest(runtimeType: unknown): boolean {
  return typeof runtimeType === "string" && runtimeType.trim().toLowerCase() === "pi";
}

export function getRuntimeReleaseBoundary(runtimeType: unknown) {
  if (!isPiRuntimeRequest(runtimeType)) return null;
  return {
    status: 400,
    code: PI_RUNTIME_RELEASE_CODE,
    error: "Pi Agent is currently an experimental preview and cannot be deployed yet. Select Hermes Agent instead."
  } as const;
}