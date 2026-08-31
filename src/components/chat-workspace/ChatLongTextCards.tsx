import { useId, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { ChevronDown, FileText, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { longTextTitle, shouldCollapsePastedText, type PendingLongTextBlock } from "./composerLongText";

export type LongTextComposerActions = {
  insert: (content: string, start: number, end: number, beforeId?: string) => void;
  update: (id: string, field: "leadingText" | "content", value: string) => void;
  unfold: (id: string, remove?: boolean) => void;
};

export function handleLongTextPaste(
  event: ClipboardEvent<HTMLTextAreaElement>,
  insert: LongTextComposerActions["insert"],
  beforeId?: string,
): boolean {
  // Leave file/image paste and ordinary short text to the existing browser behavior.
  if (event.clipboardData.files.length > 0) return false;
  const text = event.clipboardData.getData("text/plain");
  if (!shouldCollapsePastedText(text)) return false;
  event.preventDefault();
  const target = event.currentTarget;
  insert(text, target.selectionStart, target.selectionEnd, beforeId);
  window.requestAnimationFrame(() => {
    if (target.isConnected) {
      target.focus();
      target.setSelectionRange(0, 0);
    }
  });
  return true;
}

function LongTextCard({ block, index, actions, disabled, onKeyDown }: {
  block: PendingLongTextBlock;
  index: number;
  actions: LongTextComposerActions;
  disabled: boolean;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const { t } = useTranslation("dashboard");
  const [expanded, setExpanded] = useState(false);
  const editorId = useId();
  const label = t("chatWorkspace.longTextCard", { index: index + 1 });
  return (
    <div className="min-w-0 space-y-2">
      <textarea
        aria-label={t("chatWorkspace.longTextBefore", { index: index + 1 })}
        placeholder={t("chatWorkspace.longTextBefore", { index: index + 1 })}
        value={block.leadingText}
        onChange={event => actions.update(block.id, "leadingText", event.target.value)}
        onPaste={event => handleLongTextPaste(event, actions.insert, block.id)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        rows={block.leadingText.includes("\n") ? 2 : 1}
        className="w-full resize-y rounded-lg border border-outline bg-transparent px-2 py-1 text-[16px] text-content placeholder:text-content-muted focus:outline-indigo-500 sm:text-sm"
      />
      <div className="overflow-hidden rounded-xl border border-outline bg-surface-muted">
        <div className="flex min-w-0 items-center gap-2 p-2">
          <button type="button" disabled={disabled} onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-controls={editorId}
            aria-label={t("chatWorkspace.longTextEdit", { index: index + 1 })}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left text-content focus-visible:outline-indigo-500">
            <FileText className="h-5 w-5 shrink-0 text-indigo-500" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{longTextTitle(block.content) || label}</span>
              <span className="block text-xs text-content-muted">{label} · {t("chatWorkspace.longTextStats", { chars: Array.from(block.content).length.toLocaleString(), lines: block.content ? block.content.split(/\r\n|\r|\n/).length : 0 })}</span>
            </span>
            <ChevronDown className={`h-4 w-4 shrink-0 ${expanded ? "rotate-180" : ""}`} />
          </button>
          <button type="button" disabled={disabled} onClick={() => actions.unfold(block.id, true)} aria-label={t("chatWorkspace.longTextRemove", { index: index + 1 })}
            className="rounded-lg p-2 text-content-muted hover:text-red-500 focus-visible:outline-indigo-500"><X className="h-4 w-4" /></button>
        </div>
        <div id={editorId} hidden={!expanded} className="space-y-2 border-t border-outline p-2">
          <textarea aria-label={t("chatWorkspace.longTextContent", { index: index + 1 })} value={block.content}
            onChange={event => actions.update(block.id, "content", event.target.value)} disabled={disabled} rows={6}
            className="max-h-60 w-full resize-y rounded-lg border border-outline bg-surface p-2 font-mono text-[16px] text-content focus:outline-indigo-500 sm:text-sm" />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-content-muted">{t("chatWorkspace.longTextEditHint")}</span>
            <button type="button" disabled={disabled} onClick={() => actions.unfold(block.id)} className="rounded px-2 py-1 text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-500/10">{t("chatWorkspace.longTextUnfold")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChatLongTextCards({ blocks, actions, disabled, onKeyDown }: {
  blocks: PendingLongTextBlock[];
  actions: LongTextComposerActions;
  disabled: boolean;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const { t } = useTranslation("dashboard");
  if (!blocks.length) return null;
  return (
    <section aria-label={t("chatWorkspace.longTextMaterials")} className="max-h-[min(40dvh,24rem)] space-y-3 overflow-y-auto border-b border-outline p-3">
      <p className="text-xs text-content-muted">{t("chatWorkspace.longTextHint")}</p>
      {blocks.map((block, index) => <LongTextCard key={block.id} block={block} index={index} actions={actions} disabled={disabled} onKeyDown={onKeyDown} />)}
    </section>
  );
}
