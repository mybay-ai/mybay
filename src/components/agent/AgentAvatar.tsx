import { useEffect, useState } from "react";
import type { AgentInstance } from "../../types";
import { AgentRuntimeIcon } from "../brand/AgentRuntimeIcon";

interface AgentAvatarProps {
  instance?: AgentInstance;
  label: string;
  className?: string;
  defaultIconClassName?: string;
}

export function resolveAgentAvatarUrl(instance?: AgentInstance) {
  return instance?.avatar_url || instance?.configSummary?.avatarUrl || "";
}

export function resolveAgentAvatarRuntime(instance?: AgentInstance) {
  const explicitRuntime = String(instance?.runtime_type || instance?.config?.runtime_type || "").trim().toLowerCase();
  if (explicitRuntime) return explicitRuntime;
  const image = String(instance?.agent_image || "").trim().toLowerCase();
  if (image.includes("codex-runtime")) return "codex";
  if (image.includes("pi-runtime") || /(?:^|[\/_-])pi(?:[\/_-]|$)/.test(image)) return "pi";
  if (image.includes("hermes")) return "hermes";
  return "hermes";
}

export function AgentAvatar({
  instance,
  label,
  className = "h-10 w-10 rounded-xl",
  defaultIconClassName = "h-7 w-7",
}: AgentAvatarProps) {
  const avatarUrl = resolveAgentAvatarUrl(instance);
  const [imageFailed, setImageFailed] = useState(false);
  const runtimeType = resolveAgentAvatarRuntime(instance);

  useEffect(() => setImageFailed(false), [avatarUrl]);

  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      data-agent-runtime={String(runtimeType).toLowerCase()}
      data-agent-avatar={avatarUrl && !imageFailed ? "custom" : "runtime-default"}
      className={`flex shrink-0 select-none items-center justify-center overflow-hidden border border-outline bg-indigo-500/10 shadow-sm ${className}`}
    >
      {avatarUrl && !imageFailed ? (
        <img
          src={avatarUrl}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <AgentRuntimeIcon runtimeType={runtimeType} className={defaultIconClassName} />
      )}
    </div>
  );
}
