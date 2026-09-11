import { RUNTIME_DEFINITIONS } from "../../shared/runtimeCatalog";

export const PI_RUNTIME_RELEASE_CODE = "PI_RUNTIME_BETA_DISABLED";
export const UNSUPPORTED_RUNTIME_RELEASE_CODE = "UNSUPPORTED_RUNTIME_TYPE";

export function isPiRuntimeRequest(runtimeType: unknown): boolean {
  return typeof runtimeType === "string" && runtimeType.trim().toLowerCase() === "pi";
}

export function isPiRuntimeBetaEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const configured = String(env.MYBAY_ENABLE_PI_RUNTIME || "").trim().toLowerCase();
  if (!configured) return true;
  return configured === "true";
}

export function getRuntimeReleaseBoundary(runtimeType: unknown, env: NodeJS.ProcessEnv = process.env) {
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
  if (normalized === "pi" && !isPiRuntimeBetaEnabled(env)) {
    return {
      status: 400,
      code: PI_RUNTIME_RELEASE_CODE,
      error: "Pi Agent is disabled by this installation's configuration. Set MYBAY_ENABLE_PI_RUNTIME=true to enable it.",
    } as const;
  }
  if (definition.release.deploymentSupported) return null;
  return {
    status: 400,
    code: isPiRuntimeRequest(runtimeType) ? PI_RUNTIME_RELEASE_CODE : "RUNTIME_DEPLOYMENT_UNSUPPORTED",
    error: `${definition.displayName} is specification-only and cannot be deployed yet. Select an available Runtime instead.`,
  } as const;
}
