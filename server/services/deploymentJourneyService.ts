export type DeploymentJourneyStep = {
  key: "environment" | "credential" | "deployment" | "acceptance";
  done: boolean;
  status: "complete" | "pending" | "attention";
  reason: string;
  instanceId?: string | null;
};

const EXTERNAL_CHANNELS = new Set(["telegram", "feishu", "lark", "weixin", "slack", "webhook", "dingtalk", "qq_bot", "wechat_mp", "wecom"]);

function parseConfig(instance: any) {
  try {
    return typeof instance?.config_json === "string" ? JSON.parse(instance.config_json) : (instance?.config_json || {});
  } catch {
    return {};
  }
}

function hasVerifiedAssistantReply(messages: any[], instanceId: string) {
  return messages.some((message) =>
    message.instance_id === instanceId && message.role === "assistant" &&
    message.status === "completed" && String(message.content || "").trim().length > 0
  );
}

export function buildDeploymentJourney(input: {
  environmentReady: boolean;
  environmentReason?: string;
  credentials: any[];
  instances: any[];
  chatMessages: any[];
}) {
  const active = input.instances.filter((instance) => !instance.archived && !instance.archived_at && instance.status !== "archived");
  const deployed = active.find((instance) => {
    const status = String(instance.status || "");
    const health = String(instance.health_status || "");
    return ["running", "gateway_ready"].includes(status) && health !== "unhealthy" && health !== "failed";
  });
  const config = parseConfig(deployed);
  const channel = String(config.channel || "web").toLowerCase();
  const webVerified = !!deployed && hasVerifiedAssistantReply(input.chatMessages, deployed.id);
  const acceptance = config.channelAcceptance || config.channel_acceptance || {};
  const externalRequired = EXTERNAL_CHANNELS.has(channel);
  const externalVerified = !externalRequired || (
    acceptance.channel === channel && !!acceptance.verifiedAt &&
    acceptance.inboundConfirmed === true && acceptance.outboundConfirmed === true
  );
  const selectedCredentialId = config.providerCredentialId || config.provider_credential_id;
  const credentialVerified = input.credentials.some((credential) =>
    credential.verification_status === "verified" && (!selectedCredentialId || credential.id === selectedCredentialId)
  );
  const acceptanceDone = webVerified && externalVerified;
  const steps: DeploymentJourneyStep[] = [
    { key: "environment", done: input.environmentReady, status: input.environmentReady ? "complete" : "attention", reason: input.environmentReady ? "LOCAL_RUNTIME_READY" : (input.environmentReason || "LOCAL_RUNTIME_NOT_READY") },
    { key: "credential", done: credentialVerified, status: credentialVerified ? "complete" : "pending", reason: credentialVerified ? "CREDENTIAL_VERIFIED" : (input.credentials.length > 0 ? "CREDENTIAL_TEST_REQUIRED" : "CREDENTIAL_REQUIRED") },
    { key: "deployment", done: !!deployed, status: deployed ? "complete" : (active.some((instance) => ["failed", "unhealthy"].includes(String(instance.status || instance.health_status || ""))) ? "attention" : "pending"), reason: deployed ? "INSTANCE_RUNTIME_READY" : (active.length > 0 ? "INSTANCE_NOT_READY" : "INSTANCE_REQUIRED"), instanceId: deployed?.id || null },
    { key: "acceptance", done: acceptanceDone, status: acceptanceDone ? "complete" : "pending", reason: !webVerified ? "WEB_CHAT_NOT_VERIFIED" : externalVerified ? "CHAT_AND_CHANNEL_VERIFIED" : "EXTERNAL_CHANNEL_NOT_ACCEPTED", instanceId: deployed?.id || null },
  ];
  return { steps, completed: steps.filter((step) => step.done).length, total: steps.length, readyInstanceId: deployed?.id || null };
}
