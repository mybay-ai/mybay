import { Bot } from "lucide-react";

interface AgentRuntimeIconProps {
  runtimeType?: string | null;
  className?: string;
}

export function AgentRuntimeIcon({ runtimeType, className = "h-5 w-5" }: AgentRuntimeIconProps) {
  const normalizedRuntimeType = String(runtimeType || "hermes").trim().toLowerCase();

  if (normalizedRuntimeType === "hermes") {
    return (
      <span className={`relative inline-flex shrink-0 ${className}`} aria-hidden="true">
        <img
          src="/assets/agent-runtimes/hermes-agent.png"
          alt=""
          width="256"
          height="256"
          className="h-full w-full object-contain dark:hidden"
        />
        <img
          src="/assets/agent-runtimes/hermes-agent-dark.png"
          alt=""
          width="256"
          height="256"
          className="hidden h-full w-full object-contain dark:block"
        />
      </span>
    );
  }

  if (normalizedRuntimeType === "pi") {
    return (
      <img
        src="/assets/agent-runtimes/pi-agent.png"
        alt=""
        width="256"
        height="256"
        aria-hidden="true"
        className={`shrink-0 object-contain dark:invert ${className}`}
      />
    );
  }

  return <Bot className={`shrink-0 ${className}`} aria-hidden="true" />;
}
