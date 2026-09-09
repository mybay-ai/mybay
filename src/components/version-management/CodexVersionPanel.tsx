import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card } from "../ui";

export function CodexVersionPanel({ token, instances }: { token?: string; instances: any[] }) {
  const { t } = useTranslation("dashboard");
  const [version, setVersion] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setFailed(false);
    void (async () => {
      try {
        const response = await fetch("/api/instances/agent-versions?runtimeType=codex", {
          signal: controller.signal, headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) throw new Error("VERSION_QUERY_FAILED");
        const rows = await response.json();
        if (!Array.isArray(rows) || rows[0]?.runtime_type !== "codex") throw new Error("VERSION_QUERY_INVALID");
        if (!controller.signal.aborted) setVersion(rows[0]);
      } catch {
        if (!controller.signal.aborted) { setVersion(null); setFailed(true); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [token, refresh]);
  const text = (value: unknown) => typeof value === "string" && value ? value : t("codexVersions.unknown");
  return <section className="space-y-4" aria-label={t("codexVersions.title")}>
    <Card className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">{t("codexVersions.title")}</h2>
        <Button disabled={loading} onClick={() => setRefresh(value => value + 1)}>{t("codexVersions.refresh")}</Button>
      </div>
      <p className="text-sm text-content-muted">{t("codexVersions.boundary")}</p>
      {loading ? <p role="status">{t("codexVersions.loading")}</p> : failed ? <p role="alert">{t("codexVersions.error")}</p> : <dl className="grid gap-4 sm:grid-cols-2">
        {[
          ["native", version?.version], ["bridge", version?.bridge_version],
          ["image", version?.image && version?.tag ? `${version.image}:${version.tag}` : null],
          ["imageId", version?.image_id],
        ].map(([key, value]) => <div key={key} className="min-w-0"><dt className="text-sm text-content-muted">{t(`codexVersions.${key}`)}</dt><dd className="mt-1 break-all font-mono text-sm">{text(value)}</dd></div>)}
      </dl>}
    </Card>
    <Card className="space-y-3 p-4 sm:p-6">
      <h3 className="font-bold">{t("codexVersions.instances", { count: instances.length })}</h3>
      {instances.map(instance => <div key={instance.id} className="flex flex-wrap justify-between gap-2 border-t border-outline pt-3 text-sm">
        <span className="break-all">{instance.name || instance.id}</span><span className="break-all font-mono">{text(instance.agent_version || instance.agent_image_tag)}</span>
      </div>)}
    </Card>
  </section>;
}
