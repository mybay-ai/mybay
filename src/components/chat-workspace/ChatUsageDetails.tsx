import React from "react";
import { useTranslation } from "react-i18next";
import { readLocalRunUsage, createLocalRunUsage } from "../../../shared/localRunUsage";

export function ChatUsageDetails({ message }: { message: { metadata?: Record<string, unknown>; usage_prompt_tokens?: unknown; usage_completion_tokens?: unknown; usage_total_tokens?: unknown; duration_ms?: unknown } }) {
  const { t } = useTranslation("dashboard");
  const usage = readLocalRunUsage(message.metadata?.usage_evidence) ?? createLocalRunUsage({
    input_tokens: message.usage_prompt_tokens, output_tokens: message.usage_completion_tokens,
    total_tokens: message.usage_total_tokens,
  }, { source: "legacy", durationMs: message.duration_ms, durationSource: "unknown" });
  const unknown = t("chatWorkspace.usage.unknown");
  const fields: [string, string | number | null][] = [
    ["input", usage.inputTokens], ["output", usage.outputTokens], ["total", usage.totalTokens],
    ["cacheRead", usage.cacheReadTokens], ["cacheWrite", usage.cacheWriteTokens],
    ["calls", usage.modelCalls], ["model", usage.model], ["duration", usage.durationMs],
  ];
  return <details className="mt-3 whitespace-normal border-t border-outline pt-2 text-xs text-content-muted">
    <summary className="cursor-pointer font-medium">{t("chatWorkspace.usage.title")}</summary>
    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">{fields.map(([key, value]) => <React.Fragment key={key}>
      <dt>{t(`chatWorkspace.usage.${key}`)}</dt><dd className="break-all text-right">{value ?? unknown}</dd>
    </React.Fragment>)}</dl>
    <p className="mt-2">{t("chatWorkspace.usage.source")}: {t(`chatWorkspace.usage.sources.${usage.source}`)}</p>
    <p>{t("chatWorkspace.usage.scope")}: {t(`chatWorkspace.usage.scopes.${usage.scope}`)}</p>
    <p>{t("chatWorkspace.usage.durationSource")}: {t(`chatWorkspace.usage.durations.${usage.durationSource}`)}</p>
    <p className="mt-2">{t("chatWorkspace.usage.note")}</p>
  </details>;
}
