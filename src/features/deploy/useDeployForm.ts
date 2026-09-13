import { useEffect, useState } from "react";
import type { SetupFormData } from "../../types";
import { normalizeRuntimeAccessDraft } from "../../../shared/runtimeAccessPolicy";
import { HERMES_RUNTIME_DEFINITION } from "../../../shared/runtimeCatalog";

function secureRandomSuffix(length = 6) {
  return crypto.randomUUID().replaceAll("-", "").slice(0, length);
}

export function useDeployForm(initialData?: Partial<SetupFormData>) {
  const [data, setData] = useState<Partial<SetupFormData>>(() => normalizeRuntimeAccessDraft({
    id: crypto.randomUUID(),
    runtime_type: "hermes",
    path: `agent-${secureRandomSuffix()}`,
    image: HERMES_RUNTIME_DEFINITION.runtime.image,
    imageTag: HERMES_RUNTIME_DEFINITION.runtime.tag,
    channel: "web",
    allowMode: "bind_later",
    modelBillingMode: "byok",
    enableDashboard: true,
    limitsCpu: "1",
    limitsMem: "1024MB",
    ...initialData,
  }));
  const isPiRuntime = String(data.runtime_type || "hermes").toLowerCase() === "pi";
  const [trustPermissionConfirmed, setTrustPermissionConfirmed] = useState(false);
  useEffect(() => {
    if (!isPiRuntime) return;
    setData(current => normalizeRuntimeAccessDraft(current));
  }, [isPiRuntime]);

  const trustPermissionFingerprint = JSON.stringify({
    provider: data.provider,
    model: data.model,
    channel: data.channel,
    channelMode: data.channelMode,
    allowMode: data.allowMode,
    gatewayAllowAllUsers: data.gatewayAllowAllUsers,
    limitsDisk: (data as any).limitsDisk,
    providerCredentialId: data.providerCredentialId,
    providerApiKey: data.providerApiKey ? "configured" : "",
    skills: data.skills || []
  });

  useEffect(() => {
    setTrustPermissionConfirmed(false);
  }, [trustPermissionFingerprint]);

  return { data, setData, isPiRuntime, trustPermissionConfirmed, setTrustPermissionConfirmed };
}
