import { History, Loader2, RefreshCw, ScrollText, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, cn } from "../ui";

interface CodexVersion {
  runtime_type: "codex";
  version: string;
  tag: string;
  image: string;
  bridge_version?: string;
  image_id?: string;
  changelog?: string;
  changelog_zh?: string;
  published_at?: string;
  capabilities?: string[];
  is_latest?: boolean;
  prewarm_status?: string;
  certification_level?: "experimental" | "beta" | "certified";
}

interface CodexVersionPanelProps {
  token?: string;
  instances: any[];
  refreshingInstances?: boolean;
  upgradingId?: string | null;
  rollingBackId?: string | null;
  onRefreshInstances: () => void | Promise<void>;
  onUpgrade: (id: string, tag: string, event: MouseEvent) => void;
  onRollback: (id: string, event: MouseEvent) => void;
  onOpenLogs: (id: string, event: MouseEvent) => void;
}

export function CodexVersionPanel({
  token,
  instances,
  refreshingInstances = false,
  upgradingId,
  rollingBackId,
  onRefreshInstances,
  onUpgrade,
  onRollback,
  onOpenLogs,
}: CodexVersionPanelProps) {
  const { t, i18n } = useTranslation("dashboard");
  const [versions, setVersions] = useState<CodexVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    void (async () => {
      try {
        const response = await fetch("/api/instances/agent-versions?runtimeType=codex", {
          signal: controller.signal,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) throw new Error("VERSION_QUERY_FAILED");
        const rows = await response.json();
        if (!Array.isArray(rows) || rows.some((row) => row?.runtime_type !== "codex")) throw new Error("VERSION_QUERY_INVALID");
        if (!controller.signal.aborted) setVersions(rows);
      } catch {
        if (!controller.signal.aborted) {
          setVersions([]);
          setFailed(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [token, refresh]);

  const latest = useMemo(() => versions.find((version) => version.is_latest) || versions[0], [versions]);
  const text = (value: unknown) => typeof value === "string" && value ? value : t("codexVersions.unknown");
  const refreshAll = () => {
    setRefresh((value) => value + 1);
    void onRefreshInstances();
  };

  return <section className="space-y-4" aria-label={t("codexVersions.title")}>
    <Card className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{t("codexVersions.title")}</h2>
          <p className="mt-1 text-sm text-content-muted">{t("codexVersions.boundary")}</p>
        </div>
        <Button disabled={loading || refreshingInstances} onClick={refreshAll}>
          <RefreshCw className={cn("mr-2 h-4 w-4", (loading || refreshingInstances) && "animate-spin")} />
          {t("codexVersions.refresh")}
        </Button>
      </div>
      {loading ? <p role="status">{t("codexVersions.loading")}</p> : failed ? <p role="alert">{t("codexVersions.error")}</p> : <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["native", latest?.version],
          ["bridge", latest?.bridge_version],
          ["image", latest?.image && latest?.tag ? `${latest.image}:${latest.tag}` : null],
          ["imageId", latest?.image_id],
        ].map(([key, value]) => <div key={key} className="min-w-0 rounded-xl border border-outline bg-surface-muted p-3"><dt className="text-sm text-content-muted">{t(`codexVersions.${key}`)}</dt><dd className="mt-1 break-all font-mono text-sm">{text(value)}</dd></div>)}
      </dl>}
    </Card>

    <Card className="space-y-4 p-4 sm:p-6">
      <div>
        <h3 className="font-bold">{t("codexVersions.repository")}</h3>
        <p className="mt-1 text-sm text-content-muted">{t("codexVersions.repositoryHint")}</p>
      </div>
      {!loading && !failed && <div className="grid gap-3 lg:grid-cols-2">
        {versions.map((version) => <article key={version.tag} className="rounded-xl border border-outline bg-surface-muted p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <strong className="font-mono">{version.version}</strong>
              {version.is_latest && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-500">{t("codexVersions.latest")}</span>}
              <span className={cn(
                "rounded-full px-2 py-0.5 text-xs font-semibold",
                version.certification_level === "certified"
                  ? "bg-emerald-500/15 text-emerald-500"
                  : version.certification_level === "beta"
                    ? "bg-indigo-500/15 text-indigo-500"
                    : "bg-amber-500/15 text-amber-500",
              )}>{t(`codexVersions.${version.certification_level}`)}</span>
            </div>
            <span className="text-xs text-content-muted">{version.published_at?.slice(0, 10)}</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-content-secondary">{i18n.language.startsWith("zh") ? version.changelog_zh || version.changelog : version.changelog}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(version.capabilities || []).map((capability) => <span key={capability} className="rounded-md border border-outline px-2 py-1 text-xs text-content-muted">{capability}</span>)}
          </div>
          <p className="mt-3 break-all font-mono text-xs text-content-muted">{version.image}:{version.tag} · {version.prewarm_status || t("codexVersions.unknown")}</p>
        </article>)}
      </div>}
    </Card>

    <Card className="space-y-3 p-4 sm:p-6">
      <h3 className="font-bold">{t("codexVersions.instances", { count: instances.length })}</h3>
      {instances.length === 0 && <p className="text-sm text-content-muted">{t("codexVersions.noInstances")}</p>}
      {instances.map((instance) => {
        const currentVersion = String(instance.agent_version || instance.agent_image_tag || "");
        const previousVersion = String(instance.previous_image_tag || "");
        const working = upgradingId === instance.id || rollingBackId === instance.id || ["upgrading", "deploying"].includes(String(instance.status));
        const canUpgrade = Boolean(latest?.tag) && currentVersion !== latest?.version && instance.agent_image_tag !== latest?.tag;
        return <article key={instance.id} className="rounded-xl border border-outline p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="break-all">{instance.name || instance.id}</strong>
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", instance.status === "running" ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500")}>{instance.status || t("codexVersions.unknown")}</span>
              </div>
              <p className="break-all font-mono text-xs text-content-muted">{instance.id}</p>
              <p className="text-sm text-content-secondary">{t("codexVersions.current", { version: text(currentVersion) })}{previousVersion ? ` · ${t("codexVersions.rollbackPoint", { version: previousVersion })}` : ""}</p>
              {instance.upgrade_phase && <p className="text-xs text-content-muted">{t("codexVersions.phase", { phase: instance.upgrade_phase })}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!canUpgrade || working} onClick={(event) => onUpgrade(instance.id, latest!.tag, event)}>
                {upgradingId === instance.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                {canUpgrade ? t("codexVersions.upgrade", { version: latest?.version }) : t("codexVersions.latestInstalled")}
              </Button>
              <Button variant="outline" disabled={!previousVersion || previousVersion === currentVersion || working} onClick={(event) => onRollback(instance.id, event)}>
                {rollingBackId === instance.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <History className="mr-2 h-4 w-4" />}
                {previousVersion && previousVersion !== currentVersion ? t("codexVersions.rollback", { version: previousVersion }) : t("codexVersions.noRollback")}
              </Button>
              <Button variant="outline" onClick={(event) => onOpenLogs(instance.id, event)}><ScrollText className="mr-2 h-4 w-4" />{t("codexVersions.logs")}</Button>
            </div>
          </div>
        </article>;
      })}
    </Card>
  </section>;
}
