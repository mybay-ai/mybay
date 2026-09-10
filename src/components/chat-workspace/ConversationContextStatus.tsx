import React from "react";
import { createPortal } from "react-dom";
import { CircleAlert, Gauge, LoaderCircle, Minimize2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LocalRunUsage } from "../../../shared/localRunUsage";
import { api } from "../../lib/api";
import { getUsagePopoverPosition, manualCompactionStateFromPayload, type ManualCompactionState, type UsagePopoverPosition } from "./ChatUsageDetails";

function formatNumber(value: number | null | undefined, unknown: string) {
  return typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat().format(value) : unknown;
}

export function resolveDisplayedContext(usage: LocalRunUsage | null, manualResult: ManualCompactionState) {
  const estimatedAfter = manualResult?.status === "completed" ? manualResult.estimatedTokensAfter : null;
  const tokens = typeof estimatedAfter === "number" ? estimatedAfter : usage?.contextTokens ?? null;
  const window = usage?.contextWindow ?? null;
  const percent = typeof estimatedAfter === "number" && typeof window === "number" && window > 0
    ? Math.round((estimatedAfter / window) * 10_000) / 100
    : usage?.contextPercent ?? null;
  return { tokens, window, percent, estimated: typeof estimatedAfter === "number" };
}

export function getContextCompactionRecommendation(percent: number | null) {
  if (percent === null) return "unknown" as const;
  if (percent >= 85) return "urgent" as const;
  if (percent >= 70) return "recommended" as const;
  return "low" as const;
}

export function ConversationContextStatus({ usage, instanceId, conversationId, manualCompactionSupported = false, disabled = false }: {
  usage: LocalRunUsage | null;
  instanceId: string;
  conversationId: string | null;
  manualCompactionSupported?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation("dashboard");
  const [open, setOpen] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [position, setPosition] = React.useState<UsagePopoverPosition | null>(null);
  const [compacting, setCompacting] = React.useState(false);
  const [manualResult, setManualResult] = React.useState<ManualCompactionState>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const compactButtonRef = React.useRef<HTMLButtonElement>(null);
  const confirmButtonRef = React.useRef<HTMLButtonElement>(null);
  const confirmationRef = React.useRef<HTMLElement>(null);
  const unknown = t("chatWorkspace.usage.unknown");
  const displayed = resolveDisplayedContext(usage, manualResult);
  const warning = displayed.percent !== null && displayed.percent >= 70;
  const critical = displayed.percent !== null && displayed.percent >= 85;
  const accent = critical
    ? "text-rose-600 dark:text-rose-300"
    : warning ? "text-amber-600 dark:text-amber-300" : "text-violet-600 dark:text-violet-300";
  const bar = critical ? "bg-rose-500" : warning ? "bg-amber-500" : "bg-violet-500";
  const canCompact = Boolean(manualCompactionSupported && conversationId && !disabled && !compacting);
  const recommendation = getContextCompactionRecommendation(displayed.percent);

  React.useEffect(() => {
    setOpen(false);
    setConfirmOpen(false);
    setManualResult(null);
  }, [instanceId, conversationId]);

  React.useLayoutEffect(() => {
    if (!open || confirmOpen) return;
    const updatePosition = () => {
      if (!triggerRef.current || !panelRef.current) return;
      const panelHeight = panelRef.current.scrollHeight + Math.max(0, panelRef.current.offsetHeight - panelRef.current.clientHeight);
      setPosition(getUsagePopoverPosition(triggerRef.current.getBoundingClientRect(), panelHeight, window.innerWidth, window.innerHeight));
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => { window.removeEventListener("resize", updatePosition); window.removeEventListener("scroll", updatePosition, true); };
  }, [open, manualResult]);

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
  }, [open, confirmOpen]);

  React.useEffect(() => {
    if (!confirmOpen) return;
    confirmButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !compacting) {
        event.preventDefault();
        event.stopPropagation();
        setConfirmOpen(false);
        compactButtonRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(confirmationRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", closeOnEscape, true);
    return () => document.removeEventListener("keydown", closeOnEscape, true);
  }, [confirmOpen, compacting]);

  const handleCompact = async () => {
    if (!conversationId || !canCompact) return;
    setCompacting(true);
    setManualResult(null);
    try {
      const result = await api.post(`/api/instances/${encodeURIComponent(instanceId)}/conversations/${encodeURIComponent(conversationId)}/compact`, {});
      setManualResult(manualCompactionStateFromPayload(result));
    } catch (error: any) {
      setManualResult(manualCompactionStateFromPayload(error?.data));
    } finally {
      setCompacting(false);
      setConfirmOpen(false);
      compactButtonRef.current?.focus();
    }
  };

  const closeConfirmation = () => {
    if (compacting) return;
    setConfirmOpen(false);
    compactButtonRef.current?.focus();
  };

  const statusLabel = displayed.percent === null
    ? t("chatWorkspace.usage.contextUnknown")
    : t("chatWorkspace.usage.contextCompactLabel", { percent: displayed.percent });

  const panel = open ? <>
    <button type="button" aria-label={t("chatWorkspace.usage.contextClose")} className="fixed inset-0 z-[99] hidden bg-slate-950/35 backdrop-blur-[1px] max-md:block" onClick={() => setOpen(false)} />
    <div ref={panelRef} role="dialog" aria-modal={position?.mobile || undefined} aria-label={t("chatWorkspace.usage.contextPanelTitle")}
      style={position && !position.mobile ? { left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight } : undefined}
      className={`fixed z-[100] w-[min(20rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-xl border border-outline bg-surface p-3 text-left shadow-2xl [scrollbar-gutter:stable] max-md:inset-x-3 max-md:bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] max-md:max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1.5rem)] max-md:w-auto max-md:rounded-2xl max-md:p-4 ${position ? "visible" : "invisible"}`}>
      <div className="sticky -top-3 z-10 -mx-3 -mt-3 flex items-center justify-between gap-3 border-b border-outline bg-surface px-3 py-3 max-md:-top-4 max-md:-mx-4 max-md:-mt-4 max-md:px-4">
        <div><div className="text-[13px] font-semibold text-content">{t("chatWorkspace.usage.contextPanelTitle")}</div><div className="mt-0.5 text-[10px] text-content-muted">{t("chatWorkspace.usage.contextAsOfPreviousTurn")}</div></div>
        <button type="button" className="-mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-content-muted transition-colors hover:bg-surface-muted hover:text-content" aria-label={t("chatWorkspace.usage.contextClose")} onClick={() => setOpen(false)}><X className="h-4 w-4" /></button>
      </div>
      <div className="mt-3 rounded-lg border border-outline bg-surface-muted/60 p-3">
        <div className="flex items-center justify-between gap-3 text-[12px]"><span className="font-medium text-content-secondary">{t("chatWorkspace.usage.contextUsage")}</span><span className={`font-semibold tabular-nums ${accent}`}>{displayed.percent === null ? unknown : `${displayed.estimated ? "≈ " : ""}${displayed.percent}%`}</span></div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-outline/60"><div className={`h-full rounded-full transition-[width] ${bar}`} style={{ width: `${Math.min(100, displayed.percent ?? 0)}%` }} /></div>
        <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-content-muted"><span>{t("chatWorkspace.usage.contextTokens")}</span><span className="text-right font-medium tabular-nums text-content-secondary">{formatNumber(displayed.tokens, unknown)} / {formatNumber(displayed.window, unknown)}</span></div>
        {warning && <p className={`mt-2 text-[11px] leading-relaxed ${critical ? "text-rose-700 dark:text-rose-200" : "text-amber-700 dark:text-amber-200"}`}>{t("chatWorkspace.usage.contextWarningHint")}</p>}
      </div>
      {usage?.compactionStatus && <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-1 text-[11px]">
        <dt className="text-content-muted">{t("chatWorkspace.usage.compactionStatus")}</dt><dd className="text-right font-medium text-content-secondary">{t(`chatWorkspace.usage.compactionStatuses.${usage.compactionStatus}`)}</dd>
        <dt className="text-content-muted">{t("chatWorkspace.usage.compactionReason")}</dt><dd className="text-right font-medium text-content-secondary">{usage.compactionReason ? t(`chatWorkspace.usage.compactionReasons.${usage.compactionReason}`) : unknown}</dd>
        <dt className="text-content-muted">{t("chatWorkspace.usage.compactionTokensBefore")}</dt><dd className="text-right font-medium tabular-nums text-content-secondary">{formatNumber(usage.compactionTokensBefore, unknown)}</dd>
        <dt className="text-content-muted">{t("chatWorkspace.usage.compactionEstimatedTokensAfter")}</dt><dd className="text-right font-medium tabular-nums text-content-secondary">{formatNumber(usage.compactionEstimatedTokensAfter, unknown)}</dd>
      </dl>}
      {manualCompactionSupported && <div className="mt-3 border-t border-outline pb-[env(safe-area-inset-bottom)] pt-3">
        <button ref={compactButtonRef} type="button" onClick={() => setConfirmOpen(true)} disabled={!canCompact} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-400/30 dark:bg-violet-500/10 dark:text-violet-200 dark:hover:bg-violet-500/15">
          {compacting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Minimize2 className="h-4 w-4" />}{t(compacting ? "chatWorkspace.usage.compacting" : "chatWorkspace.usage.compactNow")}
        </button>
        <p className="mt-2 text-[11px] leading-relaxed text-content-muted">{t("chatWorkspace.usage.compactHint")}</p>
        {manualResult && <p className={`mt-2 rounded-lg px-2.5 py-2 text-[11px] ${manualResult.status === "completed" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200" : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200"}`}>{t(`chatWorkspace.usage.manualCompaction.${manualResult.status}`, { runtime: manualResult.runtime === "pi" ? "Pi" : manualResult.runtime === "hermes" ? "Hermes" : "Agent", before: formatNumber(manualResult.tokensBefore, unknown), after: formatNumber(manualResult.estimatedTokensAfter, unknown) })}</p>}
      </div>}
    </div>
  </> : null;

  const recommendationClass = recommendation === "urgent"
    ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/25 dark:bg-rose-500/10 dark:text-rose-200"
    : recommendation === "recommended"
      ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-200"
      : "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/25 dark:bg-violet-500/10 dark:text-violet-200";

  const confirmationDialog = confirmOpen ? (
    <div className="fixed inset-0 z-[109] flex items-center justify-center p-4 max-md:items-end max-md:p-0" role="presentation">
      <button type="button" aria-label={t("chatWorkspace.usage.compactDialogCancel")} className="absolute inset-0 bg-slate-950/55 backdrop-blur-[2px]" disabled={compacting} onClick={closeConfirmation} />
      <section ref={confirmationRef} role="alertdialog" aria-modal="true" aria-labelledby="context-compaction-dialog-title" aria-describedby="context-compaction-dialog-description" className="relative z-[110] w-full max-w-md overflow-hidden rounded-2xl border border-outline bg-surface shadow-2xl max-md:rounded-b-none max-md:rounded-t-3xl max-md:pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-5 max-md:px-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-200"><Minimize2 className="h-5 w-5" /></span>
            <div className="min-w-0">
              <h2 id="context-compaction-dialog-title" className="text-base font-semibold text-content">{t("chatWorkspace.usage.compactDialogTitle")}</h2>
              <p id="context-compaction-dialog-description" className="mt-1 text-xs leading-relaxed text-content-muted">{t("chatWorkspace.usage.compactDialogDescription")}</p>
            </div>
          </div>
          <button type="button" disabled={compacting} onClick={closeConfirmation} aria-label={t("chatWorkspace.usage.compactDialogCancel")} className="-mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-content-muted transition hover:bg-surface-muted hover:text-content disabled:opacity-40"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 pb-4 max-md:px-4">
          <div className="rounded-xl border border-outline bg-surface-muted/60 p-3">
            <div className="flex items-center justify-between gap-3 text-xs"><span className="font-medium text-content-secondary">{t("chatWorkspace.usage.contextUsage")}</span><span className={`font-semibold tabular-nums ${accent}`}>{displayed.percent === null ? unknown : `${displayed.percent}%`}</span></div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-outline/60"><div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.min(100, displayed.percent ?? 0)}%` }} /></div>
            <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-content-muted"><span>{t("chatWorkspace.usage.contextTokens")}</span><span className="font-medium tabular-nums text-content-secondary">{formatNumber(displayed.tokens, unknown)} / {formatNumber(displayed.window, unknown)}</span></div>
          </div>
          <div className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs leading-relaxed ${recommendationClass}`}>
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t(`chatWorkspace.usage.compactDialogRecommendation.${recommendation}`)}</span>
          </div>
        </div>
        <div className="flex gap-3 border-t border-outline bg-surface-muted/30 px-5 py-4 max-md:px-4">
          <button type="button" disabled={compacting} onClick={closeConfirmation} className="min-h-11 flex-1 rounded-xl border border-outline bg-surface px-4 text-sm font-semibold text-content-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50">{t("chatWorkspace.usage.compactDialogCancel")}</button>
          <button ref={confirmButtonRef} type="button" disabled={compacting} onClick={handleCompact} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-70 dark:focus:ring-offset-slate-900">
            {compacting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Minimize2 className="h-4 w-4" />}{t(compacting ? "chatWorkspace.usage.compacting" : "chatWorkspace.usage.compactDialogConfirm")}
          </button>
        </div>
      </section>
    </div>
  ) : null;

  return <>
    <button ref={triggerRef} type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => { setPosition(null); setOpen(value => !value); }} className={`inline-flex min-w-0 items-center gap-1.5 rounded-full px-2 py-1 font-medium transition-colors hover:bg-surface-muted ${accent}`} title={`${t("chatWorkspace.usage.contextAsOfPreviousTurn")} · ${statusLabel}`}>
      <Gauge className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{statusLabel}</span><span className="hidden text-content-muted lg:inline">· {t(manualCompactionSupported ? "chatWorkspace.usage.contextManage" : "chatWorkspace.usage.contextDetails")}</span>
    </button>
    {open && typeof document !== "undefined" ? createPortal(panel, document.body) : null}
    {confirmOpen && typeof document !== "undefined" ? createPortal(confirmationDialog, document.body) : null}
  </>;
}
