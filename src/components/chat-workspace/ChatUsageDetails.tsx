import React from "react";
import { Database, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { readLocalRunUsage, createLocalRunUsage, type LocalRunUsage } from "../../../shared/localRunUsage";
import { readLocalModelEvidence } from "../../../shared/localModelEvidence";

interface UsageMessage {
  metadata?: Record<string, unknown>;
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

export function ChatUsageDetails({ message }: { message: UsageMessage }) {
  const { t } = useTranslation("dashboard");
  const { usage, state, hitRate } = getUsagePresentation(message);
  const configuredModel = readLocalModelEvidence(message.metadata?.model_evidence)?.model ?? null;
  const unknown = t("chatWorkspace.usage.unknown");
  const fields: [string, string | number | null][] = [
    ["input", usage.inputTokens], ["output", usage.outputTokens], ["total", usage.totalTokens],
    ["cacheRead", usage.cacheReadTokens], ["cacheWrite", usage.cacheWriteTokens],
    ["calls", usage.modelCalls], ["model", usage.model], ["configuredModel", configuredModel], ["duration", usage.durationMs],
  ];
  const summary = state === "hit"
    ? t("chatWorkspace.usage.cacheHit", { rate: Math.round(hitRate || 0) })
    : state === "read"
      ? t("chatWorkspace.usage.cacheReadReported")
      : state === "write"
        ? t("chatWorkspace.usage.cacheWritten")
        : state === "miss"
          ? t("chatWorkspace.usage.cacheMiss")
          : t("chatWorkspace.usage.summary");
  const accent = state === "hit"
    ? "text-emerald-600 dark:text-emerald-300"
    : state === "read" || state === "write"
      ? "text-sky-600 dark:text-sky-300"
      : "text-content-muted";

  return (
    <details className="group relative inline-flex whitespace-normal">
      <summary
        className={`inline-flex cursor-pointer list-none items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium transition-colors hover:bg-surface-muted [&::-webkit-details-marker]:hidden ${accent}`}
        title={t("chatWorkspace.usage.title")}
      >
        <Database className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{summary}</span>
      </summary>
      <div
        role="dialog"
        aria-label={t("chatWorkspace.usage.title")}
        className="absolute bottom-full right-0 z-40 mb-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-outline bg-surface p-3 text-left shadow-xl max-md:fixed max-md:inset-x-3 max-md:bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] max-md:mb-0 max-md:max-h-[min(70dvh,36rem)] max-md:w-auto max-md:overflow-y-auto max-md:overscroll-contain max-md:rounded-2xl max-md:p-4 max-md:shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="text-[13px] font-semibold text-content">{t("chatWorkspace.usage.title")}</div>
          <button
            type="button"
            className="-mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-content-muted transition-colors hover:bg-surface-muted hover:text-content"
            aria-label={t("chatWorkspace.usage.close")}
            onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-outline pt-2 text-[12px]">
          {fields.map(([key, value]) => <React.Fragment key={key}>
            <dt className="text-content-muted">{t(`chatWorkspace.usage.${key}`)}</dt>
            <dd className="break-all text-right font-medium tabular-nums text-content-secondary">{formatValue(value, unknown)}</dd>
          </React.Fragment>)}
        </dl>
        <div className="mt-2 border-t border-outline pt-2 text-[11px] leading-relaxed text-content-muted">
          <p>{t("chatWorkspace.usage.source")}: {t(`chatWorkspace.usage.sources.${usage.source}`)}</p>
          <p>{t("chatWorkspace.usage.scope")}: {t(`chatWorkspace.usage.scopes.${usage.scope}`)}</p>
          <p>{t("chatWorkspace.usage.durationSource")}: {t(`chatWorkspace.usage.durations.${usage.durationSource}`)}</p>
          <p className="mt-2">{t("chatWorkspace.usage.note")}</p>
        </div>
      </div>
    </details>
  );
}
