import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronUp, Copy, Globe, RefreshCw, Server, ShieldAlert, XCircle } from "lucide-react";
import { Button } from "../../components/ui";

interface CheckItem {
  key?: string;
  name?: string;
  status: "ok" | "warn" | "fail";
  message?: string;
}

interface PreflightData { checks: CheckItem[]; proxyMode?: string }
interface Props { preflight: PreflightData | null; onRefresh: () => Promise<void>; loading: boolean }

const CHECK_GROUPS = {
  runtime: ["runtime", "storage"],
  network: ["connectivity", "proxy", "network"],
  security: ["encryption", "internal_routing"],
} as const;

const COMMANDS: Record<string, string> = {
  runtime: "docker ps -a",
  storage: "docker system df && df -h",
  connectivity: "docker ps -a",
  proxy: "docker network ls",
  network: "ss -lntp || netstat -lntp",
  encryption: "openssl rand -hex 32",
  internal_routing: "openssl rand -hex 32",
};

function checkKey(check: CheckItem, index: number) {
  return String(check.key || check.name || `check-${index}`).toLowerCase();
}

export function PreflightStep({ preflight, onRefresh, loading }: Props) {
  const { t } = useTranslation("deploy");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (key: string, command: string) => {
    await navigator.clipboard.writeText(command);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1600);
  };

  if (!preflight) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-outline bg-surface py-20">
        <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
        <span className="mt-4 text-sm font-medium text-content">{t("preflightUi.loadingTitle")}</span>
        <span className="mt-2 text-[13px] text-content-muted">{t("preflightUi.loadingDescription")}</span>
      </div>
    );
  }

  const failItems = preflight.checks.filter(item => item.status === "fail");
  const canContinue = failItems.length === 0;

  const groupFor = (item: CheckItem, index: number) => {
    const key = checkKey(item, index);
    if ((CHECK_GROUPS.security as readonly string[]).includes(key)) return "security";
    if ((CHECK_GROUPS.network as readonly string[]).includes(key)) return "network";
    return "runtime";
  };

  const translatedTitle = (item: CheckItem, index: number) => {
    const key = checkKey(item, index);
    return t(`firstRun.checks.${key}.title`, { defaultValue: item.name || item.key || key });
  };

  const renderGroup = (group: "runtime" | "network" | "security", icon: React.ReactNode) => {
    const items = preflight.checks.map((item, index) => ({ item, index })).filter(({ item, index }) => groupFor(item, index) === group);
    if (!items.length) return null;
    return (
      <section className="mt-6 space-y-3">
        <div className="flex items-center gap-2 border-b border-outline pb-2 text-base font-semibold text-content">
          {icon}<span>{t(`preflightUi.groups.${group}`)} ({items.length})</span>
        </div>
        {items.map(({ item, index }) => {
          const key = checkKey(item, index);
          const canExpand = item.status !== "ok";
          const isOpen = expanded[key] ?? item.status === "fail";
          const command = COMMANDS[key] || "docker ps -a";
          const colors = item.status === "fail"
            ? "border-l-red-500 bg-red-50 text-red-700"
            : item.status === "warn"
              ? "border-l-amber-500 bg-amber-50 text-amber-700"
              : "border-l-emerald-500 bg-emerald-50 text-emerald-700";
          const StatusIcon = item.status === "fail" ? XCircle : item.status === "warn" ? AlertTriangle : CheckCircle2;
          return (
            <article key={key} className={`rounded-xl border border-l-4 border-slate-200 bg-white shadow-sm ${colors.split(" ")[0]}`}>
              <div className="flex items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <div className="font-semibold text-content">{translatedTitle(item, index)}</div>
                  <div className="mt-0.5 text-sm text-content-muted">{t(`firstRun.checks.${key}.${item.status}`, { defaultValue: item.message || "" })}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold ${colors.split(" ").slice(1).join(" ")}`}>
                    <StatusIcon className="h-4 w-4" />{t(`preflightUi.status.${item.status}`)}
                  </span>
                  {canExpand && <button type="button" aria-label={t("preflightUi.toggleDetails")} onClick={() => setExpanded(value => ({ ...value, [key]: !isOpen }))} className="rounded-md p-1.5 text-content-muted hover:bg-surface-muted">{isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>}
                </div>
              </div>
              {canExpand && isOpen && (
                <div className="space-y-3 border-t border-outline bg-surface-muted/60 px-5 py-4 text-sm">
                  <p><strong>{t("preflightUi.problemLabel")}</strong> {t(`preflightUi.repairs.${key}.reason`, { defaultValue: t("preflightUi.repairs.default.reason") })}</p>
                  <p><strong>{t("preflightUi.solutionLabel")}</strong> {t(`preflightUi.repairs.${key}.suggestion`, { defaultValue: t("preflightUi.repairs.default.suggestion") })}</p>
                  <div>
                    <strong>{t("preflightUi.commandLabel")}</strong>
                    <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-slate-950 p-3 font-mono text-[13px] text-slate-200">
                      <span className="break-all">{command}</span>
                      <button type="button" onClick={() => copy(key, command)} title={t("preflightUi.copyCommand")} className="shrink-0 rounded p-2 text-content-muted hover:bg-slate-800 hover:text-white">
                        {copied === key ? <span className="font-sans text-emerald-400">{t("preflightUi.copied")}</span> : <Copy className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </section>
    );
  };

  return (
    <div className="animate-in space-y-6 fade-in">
      <div className={`flex flex-col justify-between gap-5 rounded-xl border p-5 shadow-sm transition-all md:flex-row md:items-center ${canContinue ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/30" : "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30"}`}>
        <div className="flex items-center gap-4">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${canContinue ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200" : "bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-200"}`}>{canContinue ? <Check className="h-6 w-6" /> : <XCircle className="h-6 w-6" />}</div>
          <div>
            <h4 className={`font-semibold ${canContinue ? "text-emerald-900 dark:text-emerald-200" : "text-red-900 dark:text-red-200"}`}>{canContinue ? t("preflightUi.summaryPassed") : t("preflightUi.summaryBlocked", { count: failItems.length })}</h4>
            <p className={`mt-1 text-sm font-medium leading-relaxed ${canContinue ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>{canContinue ? t("preflightUi.summaryPassedDescription") : t("preflightUi.summaryBlockedDescription", { items: failItems.map((item, index) => translatedTitle(item, index)).join("、") })}</p>
          </div>
        </div>
        <Button type="button" variant="outline" className="whitespace-nowrap" onClick={onRefresh} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />{t("preflightUi.recheck")}</Button>
      </div>
      {renderGroup("runtime", <Server className="h-4 w-4 text-content-muted" />)}
      {renderGroup("network", <Globe className="h-4 w-4 text-indigo-500" />)}
      {renderGroup("security", <ShieldAlert className="h-4 w-4 text-emerald-500" />)}
    </div>
  );
}
