import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SetupFormData } from "../../types";
import { api } from "../../lib/api";
import { normalizeRuntimeAccessDraft } from "../../../shared/runtimeAccessPolicy";
import { buildLocalDeploymentRequest } from "./localDeploymentRequestAdapter";
import { useDeploymentStatusPolling } from "./useDeploymentStatusPolling";

interface SubmissionOptions {
  data: Partial<SetupFormData>;
  quotaBlocked: boolean;
  quotaStatusText: string;
  isChannelAllowedForRuntime: (channel: unknown) => boolean;
  channelRestrictionMessage: string;
  trustPermissionConfirmed: boolean;
  isPiRuntime: boolean;
  onCreated: () => void;
}

export function useDeploySubmission({ data, quotaBlocked, quotaStatusText, isChannelAllowedForRuntime, channelRestrictionMessage, trustPermissionConfirmed, isPiRuntime, onCreated }: SubmissionOptions) {
  const { t } = useTranslation("deploy");
  const [loading, setLoading] = useState(false);
  const [createdInstance, setCreatedInstance] = useState<any>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const inFlight = useRef(false);
  useDeploymentStatusPolling(createdInstance, setCreatedInstance);
  const submit = async () => {
    if (quotaBlocked) {
      setSubmitError(quotaStatusText);
      return;
    }

    if (!isChannelAllowedForRuntime(data.channel)) {
      setSubmitError(channelRestrictionMessage);
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setSubmitError(null);
    try {
      const deploymentDraft = normalizeRuntimeAccessDraft(data);
      const request = buildLocalDeploymentRequest({
        draft: deploymentDraft,
        idempotencyKey,
        permissionConfirmed: trustPermissionConfirmed,
      });
      const result = await api.post(request.path, request.body, request.options);
      if (!isPiRuntime && result && result.initialDashboardCredentials) {
        sessionStorage.setItem(
          "one_time_credentials_instance_" + result.id,
          JSON.stringify(result.initialDashboardCredentials)
        );
      }
      setCreatedInstance({ ...result, deploymentStatus: result.status || "queued", currentStep: "queued", progress: 5 });
      onCreated();
    } catch (e: any) {
      console.error(e);
      setSubmitError(e.message || t("validation.submit_error"));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  const retryDeployment = async () => {
    if (!createdInstance?.deploymentTaskId) return;
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      await api.post(`/api/deployments/${createdInstance.deploymentTaskId}/retry`);
      setCreatedInstance((current: any) => ({ ...current, deploymentStatus: "retry_wait", currentStep: "queued", progress: 5, errorCode: null, errorMessage: null }));
    } catch (error: any) {
      setSubmitError(error.message || "Retry failed.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };
  return { loading, createdInstance, submitError, submit, retryDeployment };
}
