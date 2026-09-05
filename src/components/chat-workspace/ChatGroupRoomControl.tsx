import { Check, Users, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type { ChatGroupConfig } from "../../../shared/chatCollaboration";
import type { ComposerPeer } from "./chatComposerSuggestions";
import { positionComposerPopover } from "./composerPopoverPosition";

type ChatGroupRoomControlProps = {
  peers: ComposerPeer[];
  collaboration?: ChatGroupConfig | null;
  disabled?: boolean;
  onChange?: (collaboration: ChatGroupConfig | null) => Promise<void> | void;
};

export function ChatGroupRoomControl({ peers, collaboration, disabled, onChange }: ChatGroupRoomControlProps) {
  const { t } = useTranslation("dashboard");
  const id = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<ReturnType<typeof positionComposerPopover> | null>(null);
  const [selected, setSelected] = useState<string[]>(collaboration?.peerIds || []);
  const [maxRounds, setMaxRounds] = useState(collaboration?.maxRounds || 1);
  const [saving, setSaving] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelected(collaboration?.peerIds || []);
    setMaxRounds(collaboration?.maxRounds || 1);
  }, [collaboration]);

  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const anchor = buttonRef.current;
    if (!panel || !anchor) return;
    const updatePosition = () => {
      const viewport = window.visualViewport;
      const next = positionComposerPopover(anchor.getBoundingClientRect(), {
        left: viewport?.offsetLeft ?? 0,
        top: viewport?.offsetTop ?? 0,
        width: viewport?.width ?? window.innerWidth,
        height: viewport?.height ?? window.innerHeight,
      }, panel.scrollHeight + 2, { align: "end", maxWidth: 352, maxHeight: 520 });
      setPosition(previous => previous && Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
    };
    const closeOutside = (event: Event) => {
      const target = event.target as Node | null;
      if (target && !panel.contains(target) && !anchor.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      anchor.focus({ preventScroll: true });
    };
    updatePosition();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePosition);
    observer?.observe(panel);
    observer?.observe(anchor);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

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
    <div className="chat-composer-group relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled || !onChange}
        onClick={() => setOpen(value => !value)}
        className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${activeCount ? "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-400/35 dark:bg-violet-500/15 dark:text-violet-200" : "border-outline bg-surface-muted text-content-secondary hover:border-violet-300 hover:text-violet-600"}`}
        title={t("chatWorkspace.groupRoomTitle")}
        aria-label={activeCount ? t("chatWorkspace.groupRoomActive", { count: activeCount + 1 }) : t("chatWorkspace.groupRoom")}
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
      >
        <Users className="h-3.5 w-3.5" />
        <span className="chat-composer-group-label">{activeCount ? t("chatWorkspace.groupRoomActive", { count: activeCount + 1 }) : t("chatWorkspace.groupRoom")}</span>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div ref={panelRef} id={`${id}-panel`} role="dialog" aria-labelledby={`${id}-title`}
          className="fixed z-[110] overflow-y-auto overscroll-contain rounded-xl border border-outline bg-surface shadow-xl"
          style={position || { left: 0, top: 0, width: 352, visibility: "hidden" }}>
          <div className="flex items-start justify-between border-b border-outline/70 px-4 py-3">
            <div>
              <p id={`${id}-title`} className="text-sm font-semibold text-content">{t("chatWorkspace.groupRoomSetup")}</p>
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
          <div className="flex flex-col items-stretch gap-3 border-t border-outline/70 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-center justify-between gap-2 text-xs text-content-secondary sm:justify-start">
              {t("chatWorkspace.groupRoomRounds")}
              <select value={maxRounds} onChange={event => setMaxRounds(Number(event.target.value))} className="h-8 rounded-lg border border-outline bg-surface px-2 text-xs text-content">
                {[1, 2, 3].map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <div className="flex justify-end gap-2">
              {collaboration && <button type="button" disabled={saving} className="h-8 rounded-lg border border-outline px-3 text-xs font-medium text-content-secondary hover:bg-surface-muted" onClick={() => void save(null)}>{t("chatWorkspace.groupRoomDisable")}</button>}
              <button type="button" disabled={saving || selected.length < 1} className="h-8 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-45" onClick={() => void save({ mode: "group", peerIds: selected, maxRounds })}>{saving ? t("chatWorkspace.groupRoomSaving") : t("chatWorkspace.groupRoomSave")}</button>
            </div>
          </div>
        </div>, document.body,
      )}
    </div>
  );
}
