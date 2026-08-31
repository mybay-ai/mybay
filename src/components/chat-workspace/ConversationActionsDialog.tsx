import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** Native modal supplies focus containment and Escape handling, outside the scrolling sidebar. */
export function ConversationActionsDialog({ title, label, closeLabel, onClose, children }: {
  title: string;
  label: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const labelId = useId();
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => { dialog?.close(); if (trigger?.isConnected) trigger.focus(); };
  }, []);

  return createPortal(
    <dialog ref={ref} aria-labelledby={labelId} aria-describedby={titleId}
      onClose={onClose}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }}
      onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}
      className="m-auto max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-sm overflow-y-auto rounded-2xl border border-outline bg-surface p-0 text-content shadow-2xl backdrop:bg-slate-950/50">
      <div className="p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 id={labelId} className="text-sm font-semibold">{label}</h3>
          <button type="button" autoFocus onClick={onClose} aria-label={closeLabel} className="rounded-lg p-2 hover:bg-surface-muted focus-visible:outline focus-visible:outline-indigo-500"><X className="h-4 w-4" /></button>
        </div>
        <p id={titleId} className="my-3 max-h-[30dvh] overflow-y-auto whitespace-pre-wrap text-[13px] leading-6 text-content-secondary [overflow-wrap:anywhere]">{title}</p>
        <div className="grid gap-1 [&>button]:flex [&>button]:min-h-10 [&>button]:items-center [&>button]:gap-3 [&>button]:rounded-lg [&>button]:px-3 [&>button]:py-2 [&>button]:text-left [&>button]:text-[13px] [&>button]:hover:bg-surface-muted [&>button]:focus-visible:outline [&>button]:focus-visible:outline-indigo-500 [&>button]:disabled:opacity-30">{children}</div>
      </div>
    </dialog>, document.body,
  );
}
