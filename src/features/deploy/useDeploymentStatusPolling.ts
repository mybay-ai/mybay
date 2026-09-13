import { useEffect, type Dispatch, type SetStateAction } from "react";
import { api } from "../../lib/api";
import { isDeploymentSuccessful, isDeploymentTerminal } from "./deploymentUiState";

/** Observe the current deployment task; discard replies after task changes or unmount. */
export function useDeploymentStatusPolling(createdInstance: any, setCreatedInstance: Dispatch<SetStateAction<any>>) {
  useEffect(() => {
    const taskId = createdInstance?.deploymentTaskId;
    if (!taskId || isDeploymentTerminal(createdInstance?.deploymentStatus)) return;
    let stopped = false;
    const poll = async () => {
      try {
        const deployment = await api.get(`/api/deployments/${taskId}`);
        if (stopped) return;
        const terminalSuccess = isDeploymentSuccessful(deployment);
        setCreatedInstance((current: any) => current?.deploymentTaskId === taskId ? {
          ...current,
          deploymentStatus: terminalSuccess ? "success" : deployment.status,
          currentStep: deployment.currentStep,
          progress: deployment.progress,
          errorCode: deployment.errorCode,
          errorMessage: deployment.errorMessage,
          healthStatus: deployment.healthStatus,
          instanceStatus: deployment.instanceStatus,
        } : current);
      } catch (error) {
        console.error("Deployment status polling failed:", error);
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [createdInstance?.deploymentTaskId, createdInstance?.deploymentStatus]);

}
