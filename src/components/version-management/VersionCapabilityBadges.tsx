import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../ui";
import { orderAgentVersionCapabilities } from "../../../shared/agentVersionCapabilities";

const badgeTone: Record<string, string> = {
  core: "bg-control-hover text-content-secondary",
  feishu: "bg-status-info-bg text-status-info-text",
  a2a: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  bot_mode: "bg-fuchsia-50 text-fuchsia-700 dark:bg-fuchsia-950/40 dark:text-fuchsia-300",
  peer_dm: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300",
  group_rooms: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300",
  cron_continuity: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
};

export function VersionCapabilityBadges({ capabilities, compact = false }: { capabilities?: string[]; compact?: boolean }) {
  const { t } = useTranslation("dashboard");
  const ordered = orderAgentVersionCapabilities(capabilities || ["core"]);

  return (
    <div className={cn("flex flex-wrap", compact ? "gap-1" : "gap-1.5")}>
      {ordered.map((capability) => {
        const key = `versionRepository.capabilityMatrix.items.${capability}`;
        const label = t(`${key}.label`, { defaultValue: capability });
        const description = t(`${key}.description`, { defaultValue: label });
        return (
          <span
            key={capability}
            title={description}
            className={cn(
              "rounded-md px-2 py-1 text-[11px] font-semibold leading-none",
              badgeTone[capability] || "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
            )}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}
