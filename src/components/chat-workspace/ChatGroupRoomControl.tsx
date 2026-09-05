import { Check, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ChatGroupConfig } from "../../../shared/chatCollaboration";
import type { ComposerPeer } from "./chatComposerSuggestions";

type ChatGroupRoomControlProps = {
  peers: ComposerPeer[];
  collaboration?: ChatGroupConfig | null;
  disabled?: boolean;
  onChange?: (collaboration: ChatGroupConfig | null) => Promise<void> | void;
};

export function ChatGroupRoomControl({ peers, collaboration, disabled, onChange }: ChatGroupRoomControlProps) {
  const { t } = useTranslation("dashboard");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(collaboration?.peerIds || []);
  const [maxRounds, setMaxRounds] = useState(collaboration?.maxRounds || 1);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelected(collaboration?.peerIds || []);
    setMaxRounds(collaboration?.maxRounds || 1);
  }, [collaboration]);

  const save = async (next: ChatGroupConfig | null) => {
    if (!onChange || saving) return;
    setSaving(true);
    try {
      await onChange(next);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const activeCount = collaboration?.peerIds.length || 0;
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        disabled={disabled || !onChange}
        onClick={() => setOpen(value => !value)}
        className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${activeCount ? "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-400/35 dark:bg-violet-500/15 dark:text-violet-200" : "border-outline bg-surface-muted text-content-secondary hover:border-violet-300 hover:text-violet-600"}`}
        title={t("chatWorkspace.groupRoomTitle")}
        aria-expanded={open}
      >
        <Users className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{activeCount ? t("chatWorkspace.groupRoomActive", { count: activeCount + 1 }) : t("chatWorkspace.groupRoom")}</span>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-40 mb-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-outline bg-surface shadow-xl">
          <div className="flex items-start justify-between border-b border-outline/70 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-content">{t("chatWorkspace.groupRoomSetup")}</p>
              <p className="mt-1 text-xs leading-5 text-content-muted">{t("chatWorkspace.groupRoomSetupDesc")}</p>
            </div>
            <button type="button" className="rounded p-1 text-content-muted hover:bg-surface-muted" onClick={() => setOpen(false)} aria-label={t("chatWorkspace.composerClose")}><X className="h-4 w-4" /></button>
          </div>
          <div className="max-h-60 space-y-1 overflow-y-auto p-2">
            {peers.length === 0 ? (
              <p className="px-2 py-3 text-xs leading-5 text-content-muted">{t("chatWorkspace.composerMentionEmpty")}</p>
            ) : peers.map(peer => {
              const checked = selected.includes(peer.id);
              return (
                <button key={peer.id} type="button" className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left ${checked ? "border-violet-300 bg-violet-50/70 dark:border-violet-400/35 dark:bg-violet-500/10" : "border-transparent hover:bg-surface-muted"}`}
                  onClick={() => setSelected(current => checked ? current.filter(id => id !== peer.id) : current.length < 5 ? [...current, peer.id] : current)}>
                  <span className={`inline-flex h-5 w-5 items-center justify-center rounded border ${checked ? "border-violet-500 bg-violet-500 text-white" : "border-outline"}`}>{checked && <Check className="h-3.5 w-3.5" />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-content">{peer.name}</span>
                    <span className="block truncate text-xs text-content-muted">{peer.capabilities.join(" · ") || t("chatWorkspace.groupRoomGeneralCapability")}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-outline/70 px-3 py-3">
            <label className="flex items-center gap-2 text-xs text-content-secondary">
              {t("chatWorkspace.groupRoomRounds")}
              <select value={maxRounds} onChange={event => setMaxRounds(Number(event.target.value))} className="h-8 rounded-lg border border-outline bg-surface px-2 text-xs text-content">
                {[1, 2, 3].map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <div className="flex gap-2">
              {collaboration && <button type="button" disabled={saving} className="h-8 rounded-lg border border-outline px-3 text-xs font-medium text-content-secondary hover:bg-surface-muted" onClick={() => void save(null)}>{t("chatWorkspace.groupRoomDisable")}</button>}
              <button type="button" disabled={saving || selected.length < 1} className="h-8 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-45" onClick={() => void save({ mode: "group", peerIds: selected, maxRounds })}>{saving ? t("chatWorkspace.groupRoomSaving") : t("chatWorkspace.groupRoomSave")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
