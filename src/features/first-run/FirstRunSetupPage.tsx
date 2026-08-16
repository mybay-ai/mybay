import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Globe2, Loader2, Monitor, Network, RefreshCw, Server, TriangleAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui";
import { api } from "../../lib/api";

type Check = { key: string; status: "ok" | "warn" | "fail"; message?: string };
type DeploymentMode = "desktop" | "lan" | "server";
type ModeConfig = { mode: DeploymentMode; availableLanIps: string[]; bindIp: string; valid: boolean; issues: string[]; serverConfigured: boolean; serverIssues: string[]; controlPanelBindIp: string };

const modeIcons = { desktop: Monitor, lan: Network, server: Globe2 };

export function FirstRunSetupPage() {
  const { t } = useTranslation("deploy");
  const navigate = useNavigate();
  const [checks, setChecks] = useState<Check[]>([]);
  const [modeConfig, setModeConfig] = useState<ModeConfig | null>(null);
  const [mode, setMode] = useState<DeploymentMode>("desktop");
  const [lanIp, setLanIp] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [modeError, setModeError] = useState("");
  const [modeApplied, setModeApplied] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [state, deployment, preflight] = await Promise.all([
        api.get("/api/system/first-run"),
        api.get("/api/system/deployment-mode"),
        api.get("/api/system/preflight"),
      ]);

      setModeConfig(deployment);
      setMode(deployment.mode);
      setModeApplied(true);
      setLanIp(deployment.bindIp === "127.0.0.1" ? (deployment.availableLanIps?.[0] || "") : deployment.bindIp);
      setChecks(preflight.checks || []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => { void load(); }, [load]);

  const saveMode = async () => {
    setSaving(true);
    setModeError("");
    try {
      const deployment = await api.post("/api/system/deployment-mode", { mode, lanIp: mode === "lan" ? lanIp : undefined });
      setModeConfig(deployment);
      setModeApplied(true);
      const preflight = await api.get("/api/system/preflight");
      setChecks(preflight.checks || []);
    } catch (err: any) {
      setModeError(err?.data?.error || err?.message || "DEPLOYMENT_MODE_INVALID");
    } finally {
      setSaving(false);
    }
  };

  const lanNeedsRestart = mode === "lan" && Boolean(lanIp) && modeConfig?.controlPanelBindIp !== lanIp;
  const hasFailure = checks.some(check => check.status === "fail") || modeConfig?.valid === false || !modeApplied;
  const visibleIssue = modeError || (mode === modeConfig?.mode ? modeConfig?.issues?.[0] : "");
  const complete = async () => {
    setSaving(true);
    try {
      await api.post("/api/system/first-run/complete", {});
      navigate("/app", { replace: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-surface-muted px-4 py-12 text-content">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 text-center">
          <Server className="mx-auto mb-4 h-12 w-12 text-blue-600" />
          <h1 className="text-3xl font-black">{t("firstRun.title")}</h1>
          <p className="mt-3 text-content-secondary">{t("firstRun.description")}</p>
        </div>
        <section className="rounded-3xl border border-outline bg-surface p-6 shadow-xl">
          {loading ? (
            <div className="flex items-center justify-center gap-3 py-16"><Loader2 className="h-5 w-5 animate-spin" />{t("firstRun.loading")}</div>
          ) : error ? (
            <div className="py-12 text-center text-red-600">{t("firstRun.loadError")}</div>
          ) : (
            <>
              <h2 className="text-lg font-black">{t("firstRun.deploymentMode.title")}</h2>
              <p className="mt-1 text-sm text-content-muted">{t("firstRun.deploymentMode.description")}</p>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {(["desktop", "lan", "server"] as DeploymentMode[]).map(value => {
                  const Icon = modeIcons[value];
                  const serverUnavailable = value === "server" && modeConfig?.serverConfigured === false;
                  return <button key={value} type="button" onClick={() => { setMode(value); setModeApplied(false); setModeError(""); }} className={`relative rounded-2xl border p-4 text-left transition ${mode === value ? "border-blue-500 bg-blue-50 ring-2 ring-blue-100" : "border-outline hover:border-outline-strong"}`}>
                    {value === "server" && <span className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-bold ${serverUnavailable ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{t(`firstRun.deploymentMode.${serverUnavailable ? "notConfigured" : "ready"}`)}</span>}
                    <Icon className="mb-3 h-6 w-6 text-blue-600" />
                    <div className="font-bold">{t(`firstRun.deploymentMode.${value}.title`)}</div>
                    <div className="mt-1 text-xs leading-5 text-content-muted">{t(`firstRun.deploymentMode.${value}.description`)}</div>
                  </button>;
                })}
              </div>
              {mode === "lan" && <label className="mt-4 block text-sm font-semibold">{t("firstRun.deploymentMode.lanIp")}<select value={lanIp} onChange={event => { setLanIp(event.target.value); setModeApplied(false); }} className="mt-2 w-full rounded-xl border border-outline-strong bg-surface px-3 py-2"><option value="">{t("firstRun.deploymentMode.selectIp")}</option>{modeConfig?.availableLanIps.map(ip => <option key={ip} value={ip}>{ip}</option>)}</select></label>}
              {lanNeedsRestart && <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                <p>{t("firstRun.deploymentMode.lanRestartRequired")}</p>
                <code className="mt-2 block rounded-lg bg-slate-900 px-3 py-2 font-mono text-xs text-white">./quick-start.sh --lan {lanIp}</code>
              </div>}
              {mode === "server" && <div className={`mt-4 rounded-xl p-3 text-sm ${modeConfig?.serverConfigured ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
                <p>{t(modeConfig?.serverConfigured ? "firstRun.deploymentMode.serverReady" : "firstRun.deploymentMode.serverRequirement")}</p>
                {!modeConfig?.serverConfigured && <code className="mt-2 block rounded-lg bg-slate-900 px-3 py-2 font-mono text-xs text-white">./quick-start.sh --server</code>}
              </div>}
              {visibleIssue ? <p className="mt-3 text-sm text-red-600">{t(`firstRun.deploymentMode.errors.${visibleIssue}`, { defaultValue: visibleIssue })}</p> : null}
              <Button className="mt-4" variant="outline" onClick={saveMode} disabled={saving || (mode === "lan" && !lanIp) || (mode === "server" && !modeConfig?.serverConfigured) || lanNeedsRestart}>{saving ? t("firstRun.saving") : t("firstRun.deploymentMode.apply")}</Button>

              <div className="my-6 border-t border-outline" />
              <div className="space-y-3">
                {checks.map(check => (
                  <div key={check.key} className="flex items-start gap-3 rounded-2xl border border-outline p-4">
                    {check.status === "ok" ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-500" /> : <TriangleAlert className={`mt-0.5 h-5 w-5 ${check.status === "fail" ? "text-red-500" : "text-amber-500"}`} />}
                    <div><div className="font-bold">{t(`firstRun.checks.${check.key}.title`, { defaultValue: check.key })}</div><div className="mt-1 text-sm text-content-muted">{t(`firstRun.checks.${check.key}.${check.status}`)}</div></div>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-between">
            <Button variant="outline" onClick={load} disabled={loading || saving}><RefreshCw className="mr-2 h-4 w-4" />{t("firstRun.recheck")}</Button>
            <Button onClick={complete} disabled={loading || saving || error || hasFailure}>{saving ? t("firstRun.saving") : t("firstRun.continue")}</Button>
          </div>
          {hasFailure && <p className="mt-4 text-sm text-red-600">{t("firstRun.blocked")}</p>}
        </section>
      </div>
    </main>
  );
}