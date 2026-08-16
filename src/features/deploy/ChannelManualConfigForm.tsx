import { useEffect, useState } from "react";
import { Label, Input } from "../../components/ui";
import { ChannelWebhookHelper } from "../../components/ChannelWebhookHelper";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import { apiFetch } from "../../lib/api";

interface ChannelManualConfigFormProps {
  channel: string;
  data: any;
  update: (k: string, v: any) => void;
}

export function ChannelManualConfigForm({ channel, data, update }: ChannelManualConfigFormProps) {
  const { t } = useTranslation("deploy");
  const [qrSession, setQrSession] = useState<any>(null);
  const [qrBusy, setQrBusy] = useState(false);

  useEffect(() => {
    if (!qrSession?.id || qrSession.status !== "pending") return;
    const timer = window.setInterval(async () => {
      try {
        const response = await apiFetch("/api/instances/channel-onboarding/qr/" + encodeURIComponent(qrSession.id));
        const next = response?.session;
        if (!next) return;
        setQrSession(next);
        if (next.status === "completed" && next.result) {
          if (next.result.feishuAppId) update("feishuAppId", next.result.feishuAppId);
          if (next.result.feishuAppSecret) update("feishuAppSecret", next.result.feishuAppSecret);
          if (next.result.feishuRegion) update("feishuRegion", next.result.feishuRegion);
          if (next.result.weixinAccountId) update("weixinAccountId", next.result.weixinAccountId);
          if (next.result.weixinToken) update("weixinToken", next.result.weixinToken);
          if (next.result.weixinBaseUrl) update("weixinBaseUrl", next.result.weixinBaseUrl);
        }
      } catch {
        // Keep polling; transient local network failures should not discard the QR session.
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [qrSession?.id, qrSession?.status, update]);

  const startQr = async (target: "feishu" | "lark" | "weixin") => {
    setQrBusy(true);
    try {
      const response = await apiFetch("/api/instances/channel-onboarding/" + target + "/qr/start", { method: "POST" });
      setQrSession(response?.session || null);
    } catch {
      setQrSession({ channel: target, status: "failed", errorCode: "QR_NETWORK_FAILED" });
    } finally {
      setQrBusy(false);
    }
  };

  const qrErrorMessage = (errorCode?: string) => {
    if (errorCode === "EXPIRED") return t("wizardCopy.channelManual.qr.errors.expired");
    if (errorCode === "WEIXIN_QR_NETWORK_FAILED" || errorCode === "QR_NETWORK_FAILED") {
      return t("wizardCopy.channelManual.qr.errors.network");
    }
    if (errorCode === "WEIXIN_QR_SERVICE_FAILED") return t("wizardCopy.channelManual.qr.errors.service");
    return t("wizardCopy.channelManual.qr.errors.generic");
  };

  const qrPanel = (target: "feishu" | "lark" | "weixin") => {
    const active = qrSession?.channel === target;
    return (
      <div className="col-span-full rounded-lg border border-indigo-100 bg-indigo-50/70 p-3 dark:border-indigo-800/70 dark:bg-indigo-950/35">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[13px] font-semibold text-indigo-900 dark:text-indigo-200">{t("wizardCopy.channelManual.qr.title")}</div>
            <div className="text-[11px] text-indigo-700 dark:text-indigo-300">{t("wizardCopy.channelManual.qr.notice")}</div>
          </div>
          <button type="button" disabled={qrBusy} onClick={() => void startQr(target)} className="rounded-md bg-indigo-600 px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60">
            {qrBusy ? t("wizardCopy.channelManual.qr.starting") : t("wizardCopy.channelManual.qr.start")}
          </button>
        </div>
        {active && qrSession?.status === "pending" && qrSession.qrUrl && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="rounded-lg bg-surface p-2"><QRCodeSVG value={qrSession.qrUrl} size={148} /></div>
            <div className="text-[12px] text-content-secondary">{t("wizardCopy.channelManual.qr.scanHint")}</div>
          </div>
        )}
        {active && qrSession?.status === "completed" && <div className="mt-2 text-[12px] font-semibold text-emerald-700 dark:text-emerald-300">{t("wizardCopy.channelManual.qr.completed")}</div>}
        {active && ["failed", "expired", "cancelled"].includes(qrSession?.status) && <div className="mt-2 text-[12px] text-rose-700 dark:text-rose-300">{qrErrorMessage(qrSession?.errorCode)}</div>}
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-4 text-sm">
      <div style={{ position: "absolute", left: "-9999px", width: 0, height: 0, overflow: "hidden" }} aria-hidden="true">
        <input type="text" name="username" autoComplete="username" tabIndex={-1} />
        <input type="password" name="password" autoComplete="new-password" tabIndex={-1} />
      </div>
      {channel === "telegram" && (
        <>
          <div className="col-span-full space-y-1.5">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.telegram.botToken")}</Label>
            <Input 
              name="mybay-channel-telegram-bot-token"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              placeholder={t("wizardCopy.channelManual.telegram.tokenPlaceholder")} 
              value={data.telegramBotToken || ""} 
              onChange={(e: any) => update("telegramBotToken", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
            <span className="text-[11px] text-content-muted block">{t("wizardCopy.channelManual.telegram.tokenHint")}</span>
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.telegram.allowedUsers")}</Label>
            <Input 
              placeholder={t("wizardCopy.channelManual.telegram.usersPlaceholder")} 
              value={data.telegramAllowedUsers || ""} 
              onChange={(e: any) => update("telegramAllowedUsers", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
            <span className="text-[11px] text-content-muted block">{t("wizardCopy.channelManual.telegram.usersHint")}</span>
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.telegram.allowedChats")}</Label>
            <Input 
              placeholder={t("wizardCopy.channelManual.telegram.chatsPlaceholder")} 
              value={data.telegramAllowedChats || ""} 
              onChange={(e: any) => update("telegramAllowedChats", e.target.value)} 
              className="bg-surface h-10 border-slate-205 font-mono text-[13px]"
            />
            <span className="text-[11px] text-content-muted block">{t("wizardCopy.channelManual.telegram.chatsHint")}</span>
          </div>
        </>
      )}

      {channel === "feishu" && (
        <>
          {qrPanel(data.feishuRegion === "lark" ? "lark" : "feishu")}
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.feishu.region")}</Label>
            <select
              value={data.feishuRegion || "feishu"}
              onChange={(e: any) => update("feishuRegion", e.target.value)}
              className="flex h-10 w-full rounded-md border border-outline bg-surface px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
            >
              <option value="feishu">{t("wizardCopy.channelManual.feishu.regionChina")}</option>
              <option value="lark">{t("wizardCopy.channelManual.feishu.regionGlobal")}</option>
            </select>
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.feishu.appId")}</Label>
            <Input 
              name="mybay-channel-feishu-app-id"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              placeholder={t("wizardCopy.channelManual.feishu.appIdPlaceholder")} 
              value={data.feishuAppId || ""} 
              onChange={(e: any) => update("feishuAppId", e.target.value)} 
              className="bg-surface h-10 border-outline"
            />
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.feishu.appSecret")}</Label>
            <Input 
              type="password"
              name="mybay-channel-feishu-app-secret-new"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              placeholder={t("wizardCopy.channelManual.feishu.appSecretPlaceholder")} 
              value={data.feishuAppSecret || ""} 
              onChange={(e: any) => update("feishuAppSecret", e.target.value)} 
              className="bg-surface h-10 border-outline"
            />
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.feishu.allowedUsers")}</Label>
            <Input 
              placeholder={t("wizardCopy.channelManual.feishu.usersPlaceholder")} 
              value={data.feishuAllowedUsers || ""} 
              onChange={(e: any) => update("feishuAllowedUsers", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
            <span className="text-[11px] text-content-muted block">{t("wizardCopy.channelManual.feishu.usersHint")}</span>
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.feishu.allowedChats")}</Label>
            <Input 
              placeholder={t("wizardCopy.channelManual.feishu.chatsPlaceholder")} 
              value={data.feishuAllowedChats || ""} 
              onChange={(e: any) => update("feishuAllowedChats", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
            <span className="text-[11px] text-content-muted block">{t("wizardCopy.channelManual.feishu.chatsHint")}</span>
          </div>
        </>
      )}

      {channel === "slack" && (
        <>
          <div className="col-span-full space-y-1.5">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.slack.token")}</Label>
            <Input 
              type="password"
              name="mybay-channel-slack-bot-token"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              placeholder={t("wizardCopy.channelManual.slack.tokenPlaceholder")} 
              value={data.slackBotToken || ""} 
              onChange={(e: any) => update("slackBotToken", e.target.value)} 
              className="bg-surface h-10 border-outline"
            />
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.slack.allowedUsers")}</Label>
            <Input 
              placeholder={t("wizardCopy.channelManual.slack.usersPlaceholder")} 
              value={data.slackAllowedUsers || ""} 
              onChange={(e: any) => update("slackAllowedUsers", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
            <span className="text-[11px] text-content-muted block">{t("wizardCopy.channelManual.slack.usersHint")}</span>
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.slack.allowedChannels")}</Label>
            <Input 
              placeholder={t("wizardCopy.channelManual.slack.channelsPlaceholder")} 
              value={data.slackAllowedChannels || ""} 
              onChange={(e: any) => update("slackAllowedChannels", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
            <span className="text-[11px] text-content-muted block">{t("wizardCopy.channelManual.slack.channelsHint")}</span>
          </div>
        </>
      )}

      {channel === "discord" && (
        <>
          <div className="col-span-full space-y-1.5">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.discord.token")}</Label>
            <Input 
              type="password"
              name="mybay-channel-discord-bot-token"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              placeholder={t("wizardCopy.channelManual.discord.tokenPlaceholder")} 
              value={data.discordBotToken || ""} 
              onChange={(e: any) => update("discordBotToken", e.target.value)} 
              className="bg-surface h-10 border-outline"
            />
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.discord.allowedGuilds")}</Label>
            <Input 
              placeholder={t("wizardCopy.channelManual.discord.guildsPlaceholder")} 
              value={data.discordAllowedGuilds || ""} 
              onChange={(e: any) => update("discordAllowedGuilds", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.discord.allowedUsers")}</Label>
            <Input 
              placeholder={t("wizardCopy.channelManual.common.usersPlaceholder")} 
              value={data.discordAllowedUsers || ""} 
              onChange={(e: any) => update("discordAllowedUsers", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.discord.allowedChannels")}</Label>
            <Input 
              placeholder={t("wizardCopy.channelManual.discord.channelsPlaceholder")} 
              value={data.discordAllowedChannels || ""} 
              onChange={(e: any) => update("discordAllowedChannels", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
        </>
      )}

      {channel === "weixin" && (
        <>
          <div className="col-span-full rounded border border-green-100 bg-green-50 p-2.5 text-[13px] leading-relaxed text-green-800 dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:text-emerald-300">
            <strong>{t("wizardCopy.channelManual.weixin.title")}</strong>：{t("wizardCopy.channelManual.weixin.notice")}
          </div>
          {qrPanel("weixin")}
          <div className="space-y-1.5">
            <Label>{t("wizardCopy.channelManual.weixin.accountId")}</Label>
            <Input value={data.weixinAccountId || ""} onChange={(e: any) => update("weixinAccountId", e.target.value)} placeholder={t("wizardCopy.channelManual.weixin.accountIdPlaceholder")} className="bg-surface h-10 font-mono text-[13px]" />
          </div>
          <div className="space-y-1.5">
            <Label>{t("wizardCopy.channelManual.weixin.token")}</Label>
            <Input type="password" autoComplete="new-password" value={data.weixinToken || ""} onChange={(e: any) => update("weixinToken", e.target.value)} placeholder={t("wizardCopy.channelManual.weixin.tokenPlaceholder")} className="bg-surface h-10 font-mono text-[13px]" />
          </div>
          <div className="col-span-full space-y-1.5">
            <Label>{t("wizardCopy.channelManual.weixin.baseUrl")}</Label>
            <Input value={data.weixinBaseUrl || "https://ilinkai.weixin.qq.com"} onChange={(e: any) => update("weixinBaseUrl", e.target.value)} className="bg-surface h-10 font-mono text-[13px]" />
          </div>
        </>
      )}

      {channel === "webhook" && (
        <>
          <div className="col-span-full space-y-1.5">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.webhook.url")}</Label>
            <Input 
              placeholder="https://yourserver.com/api/hermes-listener" 
              value={data.webhookUrl || ""} 
              onChange={(e: any) => update("webhookUrl", e.target.value)} 
              className="bg-surface h-10 font-mono text-[13px] border-outline"
            />
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.webhook.allowedUsers")}</Label>
            <Input 
              placeholder={t("wizardCopy.channelManual.webhook.usersPlaceholder")} 
              value={data.webhookAllowedUsers || ""} 
              onChange={(e: any) => update("webhookAllowedUsers", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.webhook.allowedChannels")}</Label>
            <Input 
              placeholder={t("wizardCopy.channelManual.webhook.channelsPlaceholder")} 
              value={data.webhookAllowedChannels || ""} 
              onChange={(e: any) => update("webhookAllowedChannels", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
          <div className="col-span-full rounded-lg border border-blue-100 bg-blue-50/70 p-3 text-[13px] leading-relaxed text-blue-800 dark:border-blue-800/70 dark:bg-blue-950/35 dark:text-blue-300">
            {t("wizardCopy.channelManual.webhook.info")}
          </div>
        </>
      )}

      {channel === "api" && (
        <div className="col-span-full space-y-2 rounded-lg border border-blue-100 bg-blue-50/70 p-4 text-[13px] leading-relaxed text-blue-800 dark:border-blue-800/70 dark:bg-blue-950/35 dark:text-blue-300">
          <div>{t("wizardCopy.channelManual.api.info")}</div>
          <div className="rounded border border-blue-100/50 bg-surface/80 p-2.5 text-[13px] leading-relaxed text-content-secondary dark:border-blue-800/50 dark:bg-slate-900/70">
            {t("wizardCopy.channelManual.api.authInfo")}
          </div>
        </div>
      )}

      {channel === "whatsapp" && (
        <>
          <div className="col-span-full space-y-1.5">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.whatsapp.phoneId")}</Label>
            <Input 
              placeholder={t("wizardCopy.channelManual.whatsapp.phoneIdPlaceholder")} 
              value={data.whatsappPhoneNumberId || ""} 
              onChange={(e: any) => update("whatsappPhoneNumberId", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
          <div className="col-span-full space-y-1.5">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.whatsapp.token")}</Label>
            <Input 
              type="password"
              name="mybay-channel-whatsapp-access-token"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              placeholder={t("wizardCopy.channelManual.whatsapp.tokenPlaceholder")} 
              value={data.whatsappAccessToken || ""} 
              onChange={(e: any) => update("whatsappAccessToken", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.whatsapp.allowedUsers")}</Label>
            <Input 
              placeholder={t("wizardCopy.channelManual.whatsapp.usersPlaceholder")} 
              value={data.whatsappAllowedUsers || ""} 
              onChange={(e: any) => update("whatsappAllowedUsers", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.whatsapp.allowedChannels")}</Label>
            <Input 
              placeholder={t("wizardCopy.channelManual.whatsapp.channelsPlaceholder")} 
              value={data.whatsappAllowedChannels || ""} 
              onChange={(e: any) => update("whatsappAllowedChannels", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
        </>
      )}

      {channel === "dingtalk" && (
        <>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.dingtalk.appKey")}</Label>
            <Input 
              placeholder={t("wizardCopy.channelManual.dingtalk.appKeyPlaceholder")} 
              value={data.dingtalkAppKey || ""} 
              onChange={(e: any) => update("dingtalkAppKey", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.dingtalk.appSecret")}</Label>
            <Input 
              type="password"
              name="mybay-channel-dingtalk-app-secret"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              placeholder={t("wizardCopy.channelManual.dingtalk.appSecretPlaceholder")} 
              value={data.dingtalkAppSecret || ""} 
              onChange={(e: any) => update("dingtalkAppSecret", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
          <div className="col-span-full space-y-1.5">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.dingtalk.robotSecret")}</Label>
            <Input 
              placeholder={t("wizardCopy.channelManual.dingtalk.robotSecretPlaceholder")} 
              value={data.dingtalkRobotSecret || ""} 
              onChange={(e: any) => update("dingtalkRobotSecret", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.dingtalk.allowedUsers")}</Label>
            <Input 
              placeholder={t("wizardCopy.channelManual.dingtalk.usersPlaceholder")} 
              value={data.dingtalkAllowedUsers || ""} 
              onChange={(e: any) => update("dingtalkAllowedUsers", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.dingtalk.allowedChats")}</Label>
            <Input 
              placeholder={t("wizardCopy.channelManual.dingtalk.chatsPlaceholder")} 
              value={data.dingtalkAllowedChats || ""} 
              onChange={(e: any) => update("dingtalkAllowedChats", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
        </>
      )}

      {channel === "qq_bot" && (
        <>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.qq.appId")}</Label>
            <Input 
              name="mybay-channel-qq-bot-appid"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              placeholder={t("wizardCopy.channelManual.qq.appIdPlaceholder")} 
              value={data.qqBotAppId || ""} 
              onChange={(e: any) => update("qqBotAppId", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.qq.secret")}</Label>
            <Input 
              type="password"
              name="mybay-channel-qq-bot-secret"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              placeholder={t("wizardCopy.channelManual.qq.secretPlaceholder")} 
              value={data.qqBotSecret || ""} 
              onChange={(e: any) => update("qqBotSecret", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.qq.allowedUsers")}</Label>
            <Input 
              placeholder={t("wizardCopy.channelManual.qq.usersPlaceholder")} 
              value={data.qqBotAllowedUsers || ""} 
              onChange={(e: any) => update("qqBotAllowedUsers", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.qq.allowedGuilds")}</Label>
            <Input 
              placeholder={t("wizardCopy.channelManual.qq.guildsPlaceholder")} 
              value={data.qqBotAllowedGuilds || ""} 
              onChange={(e: any) => update("qqBotAllowedGuilds", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
          <div className="col-span-full space-y-1.5">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.qq.allowedChannels")}</Label>
            <Input 
              placeholder={t("wizardCopy.channelManual.qq.channelsPlaceholder")} 
              value={data.qqBotAllowedChannels || ""} 
              onChange={(e: any) => update("qqBotAllowedChannels", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
        </>
      )}

      {channel === "wechat_mp" && (
        <>
          <div className="col-span-full rounded border border-amber-100 bg-amber-50 p-2.5 text-[13px] leading-relaxed text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-300">
            <strong>{t("wizardCopy.channelManual.common.betaTitle")}</strong>：{t("wizardCopy.channelManual.wechat.betaDescription")}<br/>
            <strong>{t("wizardCopy.channelManual.common.callbackUrl")}</strong>：<code className="bg-surface px-1 rounded border border-outline font-mono text-[11px] select-all">https://[your-instance-domain]/callback/wechat_mp</code>
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.wechat.appId")}</Label>
            <Input 
              name="mybay-channel-wechat-mp-appid"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              placeholder={t("wizardCopy.channelManual.wechat.appIdPlaceholder")} 
              value={data.wechatMpAppId || ""} 
              onChange={(e: any) => update("wechatMpAppId", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.wechat.appSecret")}</Label>
            <Input 
              type="password"
              name="mybay-channel-wechat-mp-app-secret"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              placeholder={t("wizardCopy.channelManual.wechat.appSecretPlaceholder")} 
              value={data.wechatMpAppSecret || ""} 
              onChange={(e: any) => update("wechatMpAppSecret", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.wechat.token")}</Label>
            <Input 
              type="password"
              name="mybay-channel-wechat-mp-token"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              placeholder={t("wizardCopy.channelManual.wechat.tokenPlaceholder")} 
              value={data.wechatMpToken || ""} 
              onChange={(e: any) => update("wechatMpToken", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.wechat.aesKey")}</Label>
            <Input 
              type="password"
              name="mybay-channel-wechat-mp-encoding-aes-key"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              placeholder={t("wizardCopy.channelManual.wechat.aesKeyPlaceholder")} 
              value={data.wechatMpEncodingAesKey || ""} 
              onChange={(e: any) => update("wechatMpEncodingAesKey", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.wechat.allowedUsers")}</Label>
            <Input 
              placeholder={t("wizardCopy.channelManual.wechat.usersPlaceholder")} 
              value={data.wechatMpAllowedUsers || ""} 
              onChange={(e: any) => update("wechatMpAllowedUsers", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.wechat.allowedChats")}</Label>
            <Input 
              placeholder={t("wizardCopy.channelManual.wechat.chatsPlaceholder")} 
              value={data.wechatMpAllowedChats || ""} 
              onChange={(e: any) => update("wechatMpAllowedChats", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
        </>
      )}

      {channel === "wecom" && (
        <>
          <div className="col-span-full rounded border border-amber-100 bg-amber-50 p-2.5 text-[13px] leading-relaxed text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-300">
            <strong>{t("wizardCopy.channelManual.common.betaTitle")}</strong>：{t("wizardCopy.channelManual.wecom.betaDescription")}<br/>
            <strong>{t("wizardCopy.channelManual.common.callbackUrl")}</strong>：<code className="bg-surface px-1 rounded border border-outline font-mono text-[11px] select-all">https://[your-instance-domain]/callback/wecom</code>
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.wecom.appId")}</Label>
            <Input 
              name="mybay-channel-wecom-corpid"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              placeholder={t("wizardCopy.channelManual.wecom.appIdPlaceholder")} 
              value={data.wecomAppId || ""} 
              onChange={(e: any) => update("wecomAppId", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.wecom.appSecret")}</Label>
            <Input 
              type="password"
              name="mybay-channel-wecom-app-secret"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              placeholder={t("wizardCopy.channelManual.wecom.appSecretPlaceholder")} 
              value={data.wecomAppSecret || ""} 
              onChange={(e: any) => update("wecomAppSecret", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
          <div className="col-span-full space-y-1.5">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.wecom.agentId")}</Label>
            <Input 
              placeholder={t("wizardCopy.channelManual.wecom.agentIdPlaceholder")} 
              value={data.wecomAgentId || ""} 
              onChange={(e: any) => update("wecomAgentId", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.wecom.token")}</Label>
            <Input 
              type="password"
              name="mybay-channel-wecom-token"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              placeholder={t("wizardCopy.channelManual.wecom.tokenPlaceholder")} 
              value={data.wecomToken || ""} 
              onChange={(e: any) => update("wecomToken", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.wecom.aesKey")}</Label>
            <Input 
              type="password"
              name="mybay-channel-wecom-encoding-aes-key"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              placeholder={t("wizardCopy.channelManual.wecom.aesKeyPlaceholder")} 
              value={data.wecomEncodingAesKey || ""} 
              onChange={(e: any) => update("wecomEncodingAesKey", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.wecom.allowedUsers")}</Label>
            <Input 
              placeholder={t("wizardCopy.channelManual.wecom.usersPlaceholder")} 
              value={data.wecomAllowedUsers || ""} 
              onChange={(e: any) => update("wecomAllowedUsers", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
          <div className="space-y-1.5 col-span-1 sm:col-span-1 lg:col-span-full xl:col-span-1">
            <Label className="text-[13px] font-semibold text-content-secondary">{t("wizardCopy.channelManual.wecom.allowedChats")}</Label>
            <Input 
              placeholder={t("wizardCopy.channelManual.wecom.chatsPlaceholder")} 
              value={data.wecomAllowedChats || ""} 
              onChange={(e: any) => update("wecomAllowedChats", e.target.value)} 
              className="bg-surface h-10 border-outline font-mono text-[13px]"
            />
          </div>
        </>
      )}

      <div className="col-span-full">
        <ChannelWebhookHelper
          channel={channel}
          instanceSlug={data.path || "your-agent-slug"}
          feishuAppId={data.feishuAppId}
          feishuAppSecret={data.feishuAppSecret}
          dingtalkAppKey={data.dingtalkAppKey}
          dingtalkAppSecret={data.dingtalkAppSecret}
          telegramBotToken={data.telegramBotToken}
          qqBotAppId={data.qqBotAppId}
        />
      </div>
    </div>
  );
}
