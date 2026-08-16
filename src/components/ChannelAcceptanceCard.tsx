import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, MessageSquare, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { Button } from "./ui";
import { useTranslation } from "react-i18next";
import { ErrorCodes } from "../../shared/errorCodes";
import { extractApiErrorPayload, translateApiError } from "../lib/apiError";

const EXTERNAL_CHANNELS = new Set(["telegram", "feishu", "lark", "weixin", "slack", "webhook", "dingtalk", "qq_bot", "wechat_mp", "wecom"]);

export function ChannelAcceptanceCard({ instanceId, channel }: { instanceId: string; channel?: string }) {
  const { t, i18n } = useTranslation(["dashboard", "errors"]);
  const normalized = String(channel || "web").toLowerCase();
  const [connected, setConnected] = useState(false);
  const [acceptance, setAcceptance] = useState<any>(null);
  const [inboundConfirmed, setInboundConfirmed] = useState(false);
  const [outboundConfirmed, setOutboundConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const [status, saved] = await Promise.all([
        api.get(`/api/instances/${instanceId}/channel-status`),
        api.get(`/api/instances/${instanceId}/channel-acceptance`),
      ]);
      setConnected(Number(status?.connectedCount || 0) > 0 || Object.values(status?.channel_status || {}).some((item: any) => item?.status === "connected"));
      setAcceptance(saved?.acceptance || null);
    } catch (reason: any) {
      setError(translateApiError(t, extractApiErrorPayload(reason), ErrorCodes.UNKNOWN));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (EXTERNAL_CHANNELS.has(normalized)) void refresh(); }, [instanceId, normalized]);
  if (!EXTERNAL_CHANNELS.has(normalized)) return null;

  const submit = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.post(`/api/instances/${instanceId}/channel-acceptance`, { inboundConfirmed, outboundConfirmed });
      setAcceptance(result?.acceptance || null);
    } catch (reason: any) {
      setError(translateApiError(t, extractApiErrorPayload(reason), ErrorCodes.UNKNOWN));
    } finally {
      setLoading(false);
    }
  };

  if (acceptance?.verifiedAt && acceptance?.channel === normalized) {
    return <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-emerald-800"><div className="flex items-center gap-2 text-xs font-semibold"><CheckCircle2 className="h-4 w-4" />{t("channel_acceptance_verified")}</div><p className="mt-1 text-[11px] text-emerald-700">{new Date(acceptance.verifiedAt).toLocaleString(i18n.resolvedLanguage || i18n.language)}</p></div>;
  }

  return <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/40 p-3">
    <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2 text-xs font-semibold text-blue-900"><MessageSquare className="h-4 w-4" />{t("channel_acceptance_title")}</div><p className="mt-1 text-[11px] leading-5 text-blue-700">{t("channel_acceptance_description")}</p></div><button type="button" aria-label={t("channel_acceptance_refresh")} onClick={() => void refresh()} disabled={loading} className="text-blue-600"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button></div>
    <div className={`text-[11px] font-medium ${connected ? "text-emerald-700" : "text-amber-700"}`}>{t(connected ? "channel_acceptance_connected" : "channel_acceptance_disconnected")}</div>
    <label className="flex items-center gap-2 text-xs text-content-secondary"><input type="checkbox" checked={inboundConfirmed} onChange={(event) => setInboundConfirmed(event.target.checked)} />{t("channel_acceptance_inbound_confirmed")}</label>
    <label className="flex items-center gap-2 text-xs text-content-secondary"><input type="checkbox" checked={outboundConfirmed} onChange={(event) => setOutboundConfirmed(event.target.checked)} />{t("channel_acceptance_outbound_confirmed")}</label>
    {error && <p className="text-[11px] text-rose-600">{error}</p>}
    <Button type="button" size="sm" onClick={() => void submit()} disabled={loading || !connected || !inboundConfirmed || !outboundConfirmed} className="gap-2">{loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{t("channel_acceptance_confirm")}</Button>
  </div>;
}
