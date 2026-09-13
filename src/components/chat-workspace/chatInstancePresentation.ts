import type { TFunction } from "i18next";
import type { AgentInstance } from "../../types";
import type { ChatReadinessState } from "./chatReadinessState";

export type GroupedChatInstances = {
  ready: AgentInstance[];
  probing: AgentInstance[];
  unready: AgentInstance[];
};

export function groupChatInstances(
  instances: AgentInstance[],
  readinessByInstance: Record<string, ChatReadinessState>,
): GroupedChatInstances {
  return instances.reduce<GroupedChatInstances>((groups, instance) => {
    const readiness = readinessByInstance[instance.id];
    if (!readiness) groups.probing.push(instance);
    else if (readiness.ready) groups.ready.push(instance);
    else groups.unready.push(instance);
    return groups;
  }, { ready: [], probing: [], unready: [] });
}

export function getChatInstanceDropdownLabel(
  instance: AgentInstance,
  readinessByInstance: Record<string, ChatReadinessState>,
  t: TFunction,
) {
  const channel = instance.configSummary?.channel || "web";
  const isPureWeb = channel === "web" || channel === "none";
  const channelLabel = instance.configSummary?.channelLabel
    || (isPureWeb ? t("dashboard:chatWorkspace.pureWebLabel") : channel);
  const prefix = `[${channelLabel}] ${instance.name}`;
  const readiness = readinessByInstance[instance.id];
  if (!readiness) return `${prefix} (${t("dashboard:chatWorkspace.probingLabel")})`;
  if (readiness.ready) return prefix;
  return `${prefix} (${t(isPureWeb
    ? "dashboard:chatWorkspace.webOnlyNotReadyLabel"
    : "dashboard:chatWorkspace.externalMainChannelOnlyLabel")})`;
}

export function isCodexChatGPTAccountInstance(instance?: AgentInstance) {
  return String(instance?.runtime_type || "").toLowerCase() === "codex"
    && String(instance?.codexAuthMode || instance?.configSummary?.codexAuthMode || "chatgpt").toLowerCase() === "chatgpt";
}
