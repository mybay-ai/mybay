import React from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../../lib/api";
import { Button, Input, Label } from "../ui";
import { QRCodeSVG } from "qrcode.react";

type Configuration = { enabled: boolean; appId: string; hasSecret: boolean; allowedUsers: string; allowedChats: string; status: string };
export function InstanceManagedFeishu({ instanceId }: { instanceId: string }) {
  const { t } = useTranslation("dashboard");
  const [configuration, setConfiguration] = React.useState<Configuration | null>(null);
  const [secret, setSecret] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const [qr, setQr] = React.useState<{ id: string; status: string; qrUrl?: string } | null>(null);
  const [qrBusy, setQrBusy] = React.useState(false);
  const qrId = React.useRef<string | null>(null);
  const generation = React.useRef(0);
  React.useEffect(() => () => {
    generation.current++;
    if (qrId.current) void apiFetch(`/api/instances/channel-onboarding/qr/${encodeURIComponent(qrId.current)}/cancel`, { method: "POST" }).catch(() => {});
  }, [instanceId]);
  React.useEffect(() => {
    if (!qr || qr.status !== "pending") return;
    let active = true;
    let polling = false;
    const timer = window.setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const result = await apiFetch(`/api/instances/channel-onboarding/qr/${encodeURIComponent(qr.id)}`);
        if (!active || qrId.current !== qr.id) return;
        const session = result.session;
        if (!session) return;
        if (session.status === "completed") {
          const credentials = session.result;
          if (!credentials?.feishuAppId || !credentials?.feishuAppSecret || credentials.feishuRegion !== "feishu") {
            setNotice(t("managedFeishu.qrFailed")); setQr({ id: qr.id, status: "failed" }); return;
          }
          const openId = typeof credentials.feishuUserOpenId === "string" && /^ou_[A-Za-z0-9_-]{1,125}$/.test(credentials.feishuUserOpenId) ? credentials.feishuUserOpenId : "";
          setConfiguration(previous => previous && { ...previous, appId: credentials.feishuAppId, hasSecret: false, enabled: false, allowedUsers: openId, allowedChats: "" });
          setSecret(credentials.feishuAppSecret);
          setNotice(t(openId ? "managedFeishu.qrReady" : "managedFeishu.qrMissingUser"));
        }
        // Do not retain the credential-bearing response in QR display state.
        setQr({ id: session.id, status: session.status, qrUrl: session.qrUrl });
        if (["failed", "expired", "cancelled"].includes(session.status)) setNotice(t("managedFeishu.qrFailed"));
      } catch { if (active) setNotice(t("managedFeishu.qrFailed")); }
      finally { polling = false; }
    }, 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [qr?.id, qr?.status, t]);
  async function startQr() {
    const currentGeneration = ++generation.current;
    setQrBusy(true); setNotice("");
    const previousId = qrId.current;
    qrId.current = null; setQr(null);
    if (previousId) await apiFetch(`/api/instances/channel-onboarding/qr/${encodeURIComponent(previousId)}/cancel`, { method: "POST" }).catch(() => {});
    try {
      const result = await apiFetch("/api/instances/channel-onboarding/feishu/qr/start", { method: "POST" });
      const session = result.session;
      if (generation.current !== currentGeneration) {
        if (session?.id) void apiFetch(`/api/instances/channel-onboarding/qr/${encodeURIComponent(session.id)}/cancel`, { method: "POST" }).catch(() => {});
        return;
      }
      if (!session?.id) throw new Error("QR_SESSION_MISSING");
      qrId.current = session.id;
      setQr({ id: session.id, status: session.status, qrUrl: session.qrUrl });
      if (session.status !== "pending") setNotice(t("managedFeishu.qrFailed"));
    } catch { if (generation.current === currentGeneration) setNotice(t("managedFeishu.qrFailed")); }
    finally { if (generation.current === currentGeneration) setQrBusy(false); }
  }
  React.useEffect(() => {
    let active = true;
    qrId.current = null; setQr(null); setQrBusy(false);
    setConfiguration(null); setSecret(""); setNotice("");
    apiFetch(`/api/instances/${encodeURIComponent(instanceId)}/managed-feishu`)
      .then(result => { if (active) setConfiguration(result.configuration); })
      .catch(() => { if (active) setNotice(t("managedFeishu.failed")); });
    return () => { active = false; };
  }, [instanceId, t]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!configuration) return;
    setBusy(true); setNotice("");
    try {
      const result = await apiFetch(`/api/instances/${encodeURIComponent(instanceId)}/managed-feishu`, {
        method: "PUT", body: JSON.stringify({ enabled: configuration.enabled, appId: configuration.appId, allowedUsers: configuration.allowedUsers, allowedChats: configuration.allowedChats, ...(secret ? { appSecret: secret } : {}) }),
      });
      setConfiguration(result.configuration); setSecret(""); setNotice(t("managedFeishu.saved"));
    } catch { setNotice(t("managedFeishu.failed")); }
    finally { setBusy(false); }
  }
  return <section className="m-4 rounded-xl border border-border bg-surface p-4 text-content">
    <h3 className="font-semibold">{t("managedFeishu.title")}</h3>
    <p className="mt-2 text-sm text-content-muted">{t("managedFeishu.description")}</p>
    {configuration && <div className="mt-4 rounded-lg border border-outline p-3 space-y-3">
      <p className="text-sm text-content-muted">{t("managedFeishu.qrDescription")}</p>
      <Button type="button" variant="outline" disabled={busy || qrBusy} onClick={() => void startQr()}>{t(qrBusy ? "managedFeishu.qrGenerating" : "managedFeishu.qrStart")}</Button>
      {qr?.status === "pending" && <Button type="button" variant="outline" onClick={() => {
        const id = qrId.current; qrId.current = null; generation.current++; setQr(null);
        if (id) void apiFetch(`/api/instances/channel-onboarding/qr/${encodeURIComponent(id)}/cancel`, { method: "POST" }).catch(() => {});
      }}>{t("managedFeishu.qrCancel")}</Button>}
      {qr?.status === "pending" && qr.qrUrl && <div className="flex flex-wrap items-center gap-3">
        <div className="rounded-lg bg-white p-3"><QRCodeSVG value={qr.qrUrl} size={160} /></div>
        <p className="text-sm">{t("managedFeishu.qrWaiting")}</p>
      </div>}
    </div>}
    {configuration && <form onSubmit={save} className="mt-4 space-y-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={configuration.enabled} disabled={busy} onChange={event => setConfiguration({ ...configuration, enabled: event.target.checked })} />{t("managedFeishu.enabled")}</label>
      <div><Label htmlFor={`feishu-app-${instanceId}`}>{t("managedFeishu.appId")}</Label><Input id={`feishu-app-${instanceId}`} value={configuration.appId} disabled={busy} onChange={event => setConfiguration({ ...configuration, appId: event.target.value })} /></div>
      <div><Label htmlFor={`feishu-secret-${instanceId}`}>{t("managedFeishu.secret")}</Label><Input id={`feishu-secret-${instanceId}`} type="password" autoComplete="new-password" value={secret} disabled={busy} placeholder={configuration.hasSecret ? t("managedFeishu.secretSaved") : ""} onChange={event => setSecret(event.target.value)} /></div>
      <div><Label htmlFor={`feishu-users-${instanceId}`}>{t("managedFeishu.users")}</Label><Input id={`feishu-users-${instanceId}`} value={configuration.allowedUsers} disabled={busy} onChange={event => setConfiguration({ ...configuration, allowedUsers: event.target.value })} /></div>
      <div><Label htmlFor={`feishu-chats-${instanceId}`}>{t("managedFeishu.chats")}</Label><Input id={`feishu-chats-${instanceId}`} value={configuration.allowedChats} disabled={busy} onChange={event => setConfiguration({ ...configuration, allowedChats: event.target.value })} /></div>
      <p className="text-xs text-content-muted">{t("managedFeishu.allowlistHint")}</p>
      <Button type="submit" disabled={busy || qrBusy || qr?.status === "pending"}>{t("managedFeishu.save")}</Button>
    </form>}
    {notice && <p role="status" className="mt-3 text-sm">{notice}</p>}
  </section>;
}
