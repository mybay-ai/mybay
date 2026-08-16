export type DeploymentUiSnapshot = {
  status?: string | null;
  instanceStatus?: string | null;
};

export function isDeploymentSuccessful(snapshot: DeploymentUiSnapshot) {
  return snapshot.status === "success" && snapshot.instanceStatus === "running";
}

export const isDeploymentTerminal = (status?: string | null) => ["success", "failed", "cancelled"].includes(String(status || ""));
