import React from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../../lib/api";
import { Button, Input, Label } from "../ui";

type Configuration = { enabled: boolean; appId: string; hasSecret: boolean; allowedUsers: string; allowedChats: string; status: string };
export function InstanceManagedFeishu({ instanceId }: { instanceId: string }) {
  const { t } = useTranslation("dashboard");
  const [configuration, setConfiguration] = React.useState<Configuration | null>(null);
  const [secret, setSecret] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  React.useEffect(() => {
    let active = true;
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
    {configuration && <form onSubmit={save} className="mt-4 space-y-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={configuration.enabled} disabled={busy} onChange={event => setConfiguration({ ...configuration, enabled: event.target.checked })} />{t("managedFeishu.enabled")}</label>
      <div><Label htmlFor={`feishu-app-${instanceId}`}>{t("managedFeishu.appId")}</Label><Input id={`feishu-app-${instanceId}`} value={configuration.appId} disabled={busy} onChange={event => setConfiguration({ ...configuration, appId: event.target.value })} /></div>
      <div><Label htmlFor={`feishu-secret-${instanceId}`}>{t("managedFeishu.secret")}</Label><Input id={`feishu-secret-${instanceId}`} type="password" autoComplete="new-password" value={secret} disabled={busy} placeholder={configuration.hasSecret ? t("managedFeishu.secretSaved") : ""} onChange={event => setSecret(event.target.value)} /></div>
      <div><Label htmlFor={`feishu-users-${instanceId}`}>{t("managedFeishu.users")}</Label><Input id={`feishu-users-${instanceId}`} value={configuration.allowedUsers} disabled={busy} onChange={event => setConfiguration({ ...configuration, allowedUsers: event.target.value })} /></div>
      <div><Label htmlFor={`feishu-chats-${instanceId}`}>{t("managedFeishu.chats")}</Label><Input id={`feishu-chats-${instanceId}`} value={configuration.allowedChats} disabled={busy} onChange={event => setConfiguration({ ...configuration, allowedChats: event.target.value })} /></div>
      <p className="text-xs text-content-muted">{t("managedFeishu.allowlistHint")}</p>
      <Button type="submit" disabled={busy}>{t("managedFeishu.save")}</Button>
    </form>}
    {notice && <p role="status" className="mt-3 text-sm">{notice}</p>}
  </section>;
}
