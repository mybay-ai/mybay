import type { AgentInstance } from "../../types";
import { useTranslation } from "react-i18next";

type AgentAvatarPresentation = {
  runtime: string;
  labelKey: string;
  runtimeLabel?: string;
  initials: string;
  className: string;
};

const RUNTIME_AVATARS: Record<string, Omit<AgentAvatarPresentation, "runtime">> = {
  hermes: {
    labelKey: "chatWorkspace.agentAvatarHermes",
    initials: "H",
    className: "border-indigo-300/70 bg-gradient-to-br from-indigo-500 to-violet-700 text-white dark:border-indigo-300/40",
  },
  opencode: {
    labelKey: "chatWorkspace.agentAvatarOpenCode",
    initials: "OC",
    className: "border-emerald-300/70 bg-gradient-to-br from-emerald-500 to-teal-700 text-white dark:border-emerald-300/40",
  },
};

function normalizeRuntime(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function resolveAgentAvatarPresentation(instance?: AgentInstance): AgentAvatarPresentation {
  const runtimeSource = [instance?.runtime_type, instance?.agent_image]
    .map(normalizeRuntime)
    .find(Boolean) || "";
  const knownRuntime = Object.keys(RUNTIME_AVATARS).find(runtime => runtimeSource.includes(runtime));
  if (knownRuntime) return { runtime: knownRuntime, ...RUNTIME_AVATARS[knownRuntime] };

  const runtime = normalizeRuntime(instance?.runtime_type) || "agent";
  const words = runtime.split(/[^a-z0-9]+/i).filter(Boolean);
  const initials = words.length > 1
    ? words.slice(0, 2).map(word => word[0]).join("").toUpperCase()
    : (words[0]?.slice(0, 2).toUpperCase() || "AI");
  return {
    runtime,
    labelKey: runtime === "agent" ? "chatWorkspace.agentAvatarGeneric" : "chatWorkspace.agentAvatarCustom",
    runtimeLabel: instance?.runtime_type?.trim() || runtime,
    initials,
    className: "border-slate-300/80 bg-gradient-to-br from-slate-500 to-slate-700 text-white dark:border-slate-400/40",
  };
}

export function ChatAgentAvatar({ instance }: { instance?: AgentInstance }) {
  const { t } = useTranslation("dashboard");
  const avatar = resolveAgentAvatarPresentation(instance);
  const label = t(avatar.labelKey, { runtime: avatar.runtimeLabel });
  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      data-agent-runtime={avatar.runtime}
      className={`flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-xl border text-[12px] font-black leading-none shadow-sm ${avatar.className}`}
    >
      {avatar.initials}
    </div>
  );
}
