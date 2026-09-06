import React from "react";
import { createPortal } from "react-dom";
import { Database, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { readLocalRunUsage, createLocalRunUsage, type LocalRunUsage } from "../../../shared/localRunUsage";
import { readLocalModelEvidence } from "../../../shared/localModelEvidence";

interface UsageMessage {
  metadata?: Record<string, unknown> | null;
  usage_prompt_tokens?: unknown;
  usage_completion_tokens?: unknown;
  usage_total_tokens?: unknown;
  duration_ms?: unknown;
}

export type UsageSummaryState = "hit" | "read" | "write" | "miss" | "unavailable";

export interface UsagePresentation {
  usage: LocalRunUsage;
  state: UsageSummaryState;
  hitRate: number | null;
}

export function getUsagePresentation(message: UsageMessage): UsagePresentation {
  const usage = readLocalRunUsage(message.metadata?.usage_evidence) ?? createLocalRunUsage({
    input_tokens: message.usage_prompt_tokens,
    output_tokens: message.usage_completion_tokens,
    total_tokens: message.usage_total_tokens,
  }, { source: "legacy", durationMs: message.duration_ms, durationSource: "unknown" });
  const inputTokens = usage.inputTokens;
  const cacheReadTokens = usage.cacheReadTokens;
  const hitRate = cacheReadTokens !== null && inputTokens !== null && inputTokens > 0 && cacheReadTokens <= inputTokens
    ? (cacheReadTokens / inputTokens) * 100
    : null;
  const state: UsageSummaryState = cacheReadTokens !== null && cacheReadTokens > 0
    ? hitRate === null ? "read" : "hit"
    : usage.cacheWriteTokens !== null && usage.cacheWriteTokens > 0
      ? "write"
      : cacheReadTokens === 0
        ? "miss"
        : "unavailable";
  return { usage, state, hitRate };
}

function formatValue(value: string | number | null, unknown: string) {
  if (value === null) return unknown;
  return typeof value === "number" ? new Intl.NumberFormat().format(value) : value;
}

export type ManualCompactionState = null | {
  status: "completed" | "aborted" | "failed";
  runtime?: "hermes" | "pi";
  tokensBefore?: number | null;
  estimatedTokensAfter?: number | null;
};

export function manualCompactionStateFromPayload(payload: any): Exclude<ManualCompactionState, null> {
  return {
    status: payload?.status === "completed" ? "completed" : payload?.status === "aborted" ? "aborted" : "failed",
    runtime: payload?.runtime === "pi" ? "pi" : payload?.runtime === "hermes" ? "hermes" : undefined,
    tokensBefore: typeof payload?.tokensBefore === "number" ? payload.tokensBefore : null,
    estimatedTokensAfter: typeof payload?.estimatedTokensAfter === "number" ? payload.estimatedTokensAfter : null,
  };
}

export interface UsagePopoverPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  mobile: boolean;
}

export function getUsagePopoverPosition(
  anchor: Pick<DOMRect, "top" | "right" | "bottom">,
  panelHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): UsagePopoverPosition {
  const gutter = 12;
  const gap = 8;
  const mobile = viewportWidth < 768;
  const width = Math.max(0, Math.min(320, viewportWidth - gutter * 2));
  const boundedHeight = Math.min(panelHeight, viewportHeight - gutter * 2);
  if (mobile) {
    return { left: gutter, top: Math.max(gutter, viewportHeight - boundedHeight - gutter), width: Math.max(0, viewportWidth - gutter * 2), maxHeight: Math.max(0, viewportHeight - gutter * 2), mobile: true };
  }
  const spaceAbove = anchor.top - gutter - gap;
  const spaceBelow = viewportHeight - anchor.bottom - gutter - gap;
  const openAbove = spaceAbove >= Math.min(boundedHeight, 240) || spaceAbove >= spaceBelow;
  const availableHeight = Math.max(160, openAbove ? spaceAbove : spaceBelow);
  const maxHeight = Math.min(boundedHeight, availableHeight);
  const top = openAbove ? Math.max(gutter, anchor.top - gap - maxHeight) : Math.min(viewportHeight - gutter - maxHeight, anchor.bottom + gap);
  return { left: Math.max(gutter, Math.min(anchor.right - width, viewportWidth - gutter - width)), top, width, maxHeight, mobile: false };
}

export function ChatUsageDetails({ message }: { message: UsageMessage }) {
  const { t } = useTranslation("dashboard");
  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState<UsagePopoverPosition | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const { usage, state, hitRate } = getUsagePresentation(message);
  const configuredModel = readLocalModelEvidence(message.metadata?.model_evidence)?.model ?? null;
  const unknown = t("chatWorkspace.usage.unknown");
  const primaryFields: [string, string | number | null][] = [["input", usage.inputTokens], ["output", usage.outputTokens], ["total", usage.totalTokens], ["model", usage.model]];
  const technicalFields: [string, string | number | null][] = [["cacheRead", usage.cacheReadTokens], ["cacheWrite", usage.cacheWriteTokens], ["calls", usage.modelCalls], ["configuredModel", configuredModel], ["duration", usage.durationMs]];
  const cacheSummary = state === "hit"
    ? t("chatWorkspace.usage.cacheHit", { rate: Math.round(hitRate || 0) })
    : state === "read" ? t("chatWorkspace.usage.cacheReadReported")
      : state === "write" ? t("chatWorkspace.usage.cacheWritten")
        : state === "miss" ? t("chatWorkspace.usage.cacheMiss") : null;

  React.useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      if (!triggerRef.current || !panelRef.current) return;
      const panelHeight = panelRef.current.scrollHeight + Math.max(0, panelRef.current.offsetHeight - panelRef.current.clientHeight);
      setPosition(getUsagePopoverPosition(triggerRef.current.getBoundingClientRect(), panelHeight, window.innerWidth, window.innerHeight));
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => { window.removeEventListener("resize", updatePosition); window.removeEventListener("scroll", updatePosition, true); };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOnOutsideClick); document.removeEventListener("keydown", closeOnEscape); };
  }, [open]);

  const panel = open ? <>
    <button type="button" aria-label={t("chatWorkspace.usage.close")} className="fixed inset-0 z-[99] hidden bg-slate-950/35 backdrop-blur-[1px] max-md:block" onClick={() => setOpen(false)} />
    <div ref={panelRef} role="dialog" aria-modal={position?.mobile || undefined} aria-label={t("chatWorkspace.usage.title")}
      style={position && !position.mobile ? { left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight } : undefined}
      className={`fixed z-[100] w-[min(20rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-xl border border-outline bg-surface p-3 text-left shadow-2xl [scrollbar-gutter:stable] max-md:inset-x-3 max-md:bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] max-md:max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1.5rem)] max-md:w-auto max-md:rounded-2xl max-md:p-4 ${position ? "visible" : "invisible"}`}>
      <div className="sticky -top-3 z-10 -mx-3 -mt-3 flex items-center justify-between gap-3 border-b border-outline bg-surface px-3 py-3 max-md:-top-4 max-md:-mx-4 max-md:-mt-4 max-md:px-4">
        <div className="text-[13px] font-semibold text-content">{t("chatWorkspace.usage.title")}</div>
        <button type="button" className="-mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-content-muted transition-colors hover:bg-surface-muted hover:text-content" aria-label={t("chatWorkspace.usage.close")} onClick={() => setOpen(false)}><X className="h-4 w-4" /></button>
      </div>
      {cacheSummary && <p className="mt-3 rounded-lg bg-surface-muted px-2.5 py-2 text-[11px] font-medium text-content-secondary">{cacheSummary}</p>}
      <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[12px]">
        {primaryFields.map(([key, value]) => <React.Fragment key={key}><dt className="min-w-0 break-words text-content-muted">{t(`chatWorkspace.usage.${key}`)}</dt><dd className="min-w-0 break-words text-right font-medium tabular-nums text-content-secondary">{formatValue(value, unknown)}</dd></React.Fragment>)}
      </dl>
      <details className="group mt-3 border-t border-outline pt-2">
        <summary className="cursor-pointer list-none text-[11px] font-medium text-content-muted hover:text-content-secondary [&::-webkit-details-marker]:hidden">{t("chatWorkspace.usage.technicalDetails")} <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">›</span></summary>
        <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-1 text-[11px]">
          {technicalFields.map(([key, value]) => <React.Fragment key={key}><dt className="min-w-0 break-words text-content-muted">{t(`chatWorkspace.usage.${key}`)}</dt><dd className="min-w-0 break-words text-right font-medium tabular-nums text-content-secondary">{formatValue(value, unknown)}</dd></React.Fragment>)}
        </dl>
        <div className="mt-2 border-t border-outline pt-2 text-[11px] leading-relaxed text-content-muted">
          <p>{t("chatWorkspace.usage.source")}: {t(`chatWorkspace.usage.sources.${usage.source}`)}</p>
          <p>{t("chatWorkspace.usage.scope")}: {t(`chatWorkspace.usage.scopes.${usage.scope}`)}</p>
          <p>{t("chatWorkspace.usage.durationSource")}: {t(`chatWorkspace.usage.durations.${usage.durationSource}`)}</p>
          <p className="mt-2">{t("chatWorkspace.usage.note")}</p>
        </div>
      </details>
    </div>
  </> : null;

  return <span className="inline-flex min-w-0 whitespace-normal">
    <button ref={triggerRef} type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => { setPosition(null); setOpen(value => !value); }} className="inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium text-content-muted transition-colors hover:bg-surface-muted hover:text-content-secondary" title={t("chatWorkspace.usage.title")}>
      <Database className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{t("chatWorkspace.usage.turnSummary")}</span>
    </button>
    {open && typeof document !== "undefined" ? createPortal(panel, document.body) : null}
  </span>;
}
