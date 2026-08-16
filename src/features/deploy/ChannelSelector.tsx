import { Globe, Send, Slack, Terminal, MessageSquareMore, Check, Wind } from "lucide-react";
import { channelRegistry } from "../../../shared/channelRegistry";
import { useTranslation } from "react-i18next";

export const CHANNELS = [
  { id: "web", icon: <Globe className="w-5 h-5 text-indigo-500" /> },
  { id: "telegram", icon: <Send className="w-5 h-5 text-[#229ed9]" /> },
  { id: "feishu", icon: <Wind className="w-5 h-5 text-[#3370ff]" /> },
  { id: "weixin", icon: <MessageSquareMore className="w-5 h-5 text-[#07c160]" /> },
  { id: "slack", icon: <Slack className="w-5 h-5 text-[#4a154b]" /> },
  { id: "webhook", icon: <Terminal className="w-5 h-5 text-content-secondary" /> },
  { id: "api", icon: <Terminal className="w-5 h-5 text-emerald-500" /> }
];
export const EXTERNAL_CHANNEL_IDS = new Set([
  "telegram",
  "feishu",
  "lark",
  "weixin",
  "slack",
  "webhook",
  "api"
]);

export function isExternalDeployChannel(channel: string | undefined | null) {
  return EXTERNAL_CHANNEL_IDS.has(String(channel || "").toLowerCase());
}

interface ChannelSelectorProps {
  selectedId: string;
  onSelect: (id: string) => void;
  externalChannelsAllowed?: boolean;
  isChannelAllowed?: (id: string) => boolean;
  lockedMessage?: string;
}

export function ChannelSelector({ selectedId, onSelect, externalChannelsAllowed = true, isChannelAllowed, lockedMessage }: ChannelSelectorProps) {
  const { t } = useTranslation("deploy");
  return (
    <div className="space-y-2">
      <span className="text-[11px] font-bold text-content-muted uppercase tracking-wider block">{t("wizardCopy.channelSelector.title")}</span>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-3">
        {CHANNELS.map(c => {
          const isSelected = selectedId === c.id;
          const regItem = channelRegistry[c.id];
          const supportLevel = regItem?.supportLevel || "experimental";
          const isLocked = isChannelAllowed ? !isChannelAllowed(c.id) : (isExternalDeployChannel(c.id) && !externalChannelsAllowed);

          return (
            <div
              key={c.id}
              role="button"
              aria-disabled={isLocked}
              title={isLocked ? (lockedMessage || "Channel disabled") : undefined}
              onClick={() => {
                if (isLocked) return;
                onSelect(c.id);
              }}
              className={`rounded-xl p-3.5 flex gap-3.5 items-start select-none transition border-2 ${
                isLocked
                  ? "cursor-not-allowed border-outline bg-surface dark:border-slate-700/70 dark:bg-slate-900/70 opacity-80 dark:opacity-70"
                  : isSelected
                    ? "cursor-pointer border-blue-600 dark:border-blue-400 bg-blue-50/20 dark:bg-blue-950/40 shadow-sm ring-2 ring-blue-500/10 animate-in zoom-in-98 duration-100"
                    : "cursor-pointer border-slate-205 dark:border-slate-700 hover:border-slate-500 bg-surface dark:bg-slate-900/70 hover:bg-control-hover/30 dark:hover:bg-slate-800/80"
              }`}
            >
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${isSelected ? "bg-blue-105 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300" : "bg-surface-muted text-content-muted"}`}>
                {c.icon}
              </div>
              <div className="space-y-1 text-left min-w-0 flex-1">
                <span className="text-[13px] font-bold text-content flex items-center justify-between gap-1">
                  <span className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="truncate">{t(`wizardCopy.channelSelector.channels.${c.id}.name`)}</span>
                    {supportLevel === "experimental" && (
                      <span className="shrink-0 text-[8px] bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-300 border border-amber-100 dark:border-amber-800/60 rounded px-1 scale-90 origin-left">{t("wizardCopy.channelSelector.experimental")}</span>
                    )}
                    {supportLevel === "beta" && (
                      <span className="shrink-0 text-[8px] bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300 border border-blue-100 dark:border-blue-800/60 rounded px-1 scale-90 origin-left">Beta</span>
                    )}
                    {isLocked && (
                      <span className="shrink-0 text-[8px] bg-surface-muted text-content-muted border border-outline rounded px-1 scale-90 origin-left">{t("wizardCopy.channelSelector.restricted")}</span>
                    )}
                  </span>
                  {isSelected && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                </span>
                <p className="text-[11px] leading-relaxed text-content-muted break-words line-clamp-2">
                  {t(`wizardCopy.channelSelector.channels.${c.id}.description`)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
