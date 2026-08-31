import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";

export function ChatQuestionSetup({ instanceId, busy }: { instanceId: string; busy: boolean }) {
  const { t } = useTranslation("dashboard");
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [installing, setInstalling] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void api.get(`/api/instances/${instanceId}/question-bridge`).then(result => { if (live) setInstalled(result.installed); }).catch(() => {});
    return () => { live = false; };
  }, [instanceId]);
  const install = async () => {
    if (busy || installing) return;
    setInstalling(true); setFailed(false);
    try { await api.post(`/api/instances/${instanceId}/question-bridge/install`, { restart: true }); setInstalled(true); }
    catch { setFailed(true); }
    finally { setInstalling(false); }
  };
  if (installed === null) return null;
  return <details className="mx-4 mb-1 text-xs text-content-secondary">
    <summary className="cursor-pointer">{t("chatWorkspace.questionSetupTitle")}</summary>
    <p className="my-2">{t(installed ? "chatWorkspace.questionInstalled" : "chatWorkspace.questionSetupNotice")}</p>
    <button type="button" disabled={busy || installing} onClick={() => void install()} className="rounded-lg border border-outline px-3 py-2 disabled:opacity-50">{t(installing ? "chatWorkspace.questionInstalling" : installed ? "chatWorkspace.questionReinstall" : "chatWorkspace.questionInstall")}</button>
    {failed && <p role="alert" className="mt-2 text-red-600">{t("chatWorkspace.questionInstallFailed")}</p>}
  </details>;
}
