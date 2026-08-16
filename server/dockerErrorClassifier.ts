export const DEPLOYMENT_ERROR_CODES = [
  "PORT_CONFLICT",
  "DOCKER_UNAVAILABLE",
  "IMAGE_PULL_FAILED",
  "NETWORK_CREATE_FAILED",
  "CONTAINER_CREATE_FAILED",
  "CONTAINER_START_FAILED",
  "HEALTH_CHECK_FAILED",
  "DEPLOYMENT_TIMEOUT",
  "DEPLOYMENT_CANCELLED",
  "DEPLOYMENT_RETRY_EXHAUSTED",
  "CONTAINER_MISSING",
  "CLEANUP_FAILED",
  "QUOTA_EXCEEDED",
  "PATH_CONFLICT",
] as const;

export type DeploymentErrorCode = typeof DEPLOYMENT_ERROR_CODES[number];

export type ClassifiedDockerError = {
  code: DeploymentErrorCode;
  message: string;
  detail: string;
  retryable: boolean;
};

const patterns: Array<{ code: DeploymentErrorCode; test: RegExp; message: string; retryable: boolean }> = [
  {
    code: "PORT_CONFLICT",
    test: /port is already allocated|address already in use|eaddrinuse|ports are not available|only one usage of each socket address|bind for 0\.0\.0\.0|failed programming external connectivity/i,
    message: "The selected host port is already in use. MyBay will automatically select another port and retry.",
    retryable: true,
  },
  {
    code: "DOCKER_UNAVAILABLE",
    test: /cannot connect to the docker daemon|docker engine is unavailable|connect enoent|econnrefused|docker\.sock|is the docker daemon running|open \\.\/pipe\/docker/i,
    message: "Docker Engine is unavailable. Please start Docker and retry deployment.",
    retryable: true,
  },
  {
    code: "IMAGE_PULL_FAILED",
    test: /pull access denied|manifest unknown|failed to pull|image.*not found|unauthorized.*registry/i,
    message: "The container image could not be downloaded. Check the image name and registry access, then retry.",
    retryable: false,
  },
  {
    code: "NETWORK_CREATE_FAILED",
    test: /network.*(create|driver|not found|failed)|failed.*network/i,
    message: "The isolated Docker network could not be prepared.",
    retryable: true,
  },
  {
    code: "CONTAINER_START_FAILED",
    test: /container.*start|failed to start|driver failed programming external connectivity/i,
    message: "The instance container was created but could not be started.",
    retryable: true,
  },
  {
    code: "HEALTH_CHECK_FAILED",
    test: /health.?check|readiness|unhealthy|did not become ready/i,
    message: "The container started but did not pass its readiness checks.",
    retryable: true,
  },
];

export function classifyDockerError(error: unknown, fallback: DeploymentErrorCode = "CONTAINER_CREATE_FAILED"): ClassifiedDockerError {
  const candidate = error as any;
  const detail = String(candidate?.detail || candidate?.error_detail || candidate?.deployment_error || candidate?.message || candidate?.error_message || error || "Unknown Docker error");
  const explicitCode = (candidate?.code || candidate?.error_code) as DeploymentErrorCode | undefined;
  if (explicitCode && DEPLOYMENT_ERROR_CODES.includes(explicitCode)) {
    return {
      code: explicitCode,
      message: String(candidate?.userMessage || candidate?.error_message || candidate?.message || detail),
      detail,
      retryable: Boolean(candidate?.retryable),
    };
  }
  const matched = patterns.find((entry) => entry.test.test(detail));
  if (matched) return { code: matched.code, message: matched.message, detail, retryable: matched.retryable };
  const fallbackMessages: Record<DeploymentErrorCode, string> = {
    PORT_CONFLICT: "The selected host port is already in use.",
    DOCKER_UNAVAILABLE: "Docker Engine is unavailable. Please start Docker and retry deployment.",
    IMAGE_PULL_FAILED: "The container image could not be downloaded.",
    NETWORK_CREATE_FAILED: "The isolated Docker network could not be prepared.",
    CONTAINER_CREATE_FAILED: "The instance container could not be created.",
    CONTAINER_START_FAILED: "The instance container could not be started.",
    DEPLOYMENT_RETRY_EXHAUSTED: "Deployment worker recovery attempts were exhausted.",
    CONTAINER_MISSING: "The database expected a running instance, but its Docker container is missing.",
    HEALTH_CHECK_FAILED: "The instance did not pass its readiness checks.",
    DEPLOYMENT_TIMEOUT: "Deployment exceeded its deadline and was cancelled.",
    DEPLOYMENT_CANCELLED: "Deployment was cancelled.",
    CLEANUP_FAILED: "One or more instance resources could not be removed.",
    QUOTA_EXCEEDED: "The instance quota has been reached.",
    PATH_CONFLICT: "Another instance already uses this path.",
  };
  return { code: fallback, message: fallbackMessages[fallback], detail, retryable: false };
}

export class DeploymentError extends Error {
  readonly code: DeploymentErrorCode;
  readonly detail: string;
  readonly retryable: boolean;
  readonly userMessage: string;

  constructor(classified: ClassifiedDockerError) {
    super(classified.detail);
    this.name = "DeploymentError";
    this.code = classified.code;
    this.detail = classified.detail;
    this.retryable = classified.retryable;
    this.userMessage = classified.message;
  }
}

export function toDeploymentError(error: unknown, fallback: DeploymentErrorCode = "CONTAINER_CREATE_FAILED"): DeploymentError {
  return error instanceof DeploymentError ? error : new DeploymentError(classifyDockerError(error, fallback));
}

export function isSimulatedDeploymentEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV === "test" && env.MYBAY_ENABLE_SIMULATED_DEPLOYMENT === "true";
}
