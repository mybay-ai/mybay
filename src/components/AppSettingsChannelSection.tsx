import { Label, Input } from "./ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import { apiFetch } from "../lib/api";
import { isDeployChannelAllowedByEntitlement } from "../../shared/planChannelAccess";
import { Info } from "lucide-react";
import { ChannelWebhookHelper } from "./ChannelWebhookHelper";

interface ChannelSectionProps {
  channel: string;
  setChannel: (v: string) => void;
  externalChannelsAllowed?: boolean;
  // Specific settings
  telegramBotToken: string; setTelegramBotToken: (v: string) => void;
  telegramAllowedUsers: string; setTelegramAllowedUsers: (v: string) => void;
  discordBotToken: string; setDiscordBotToken: (v: string) => void;
  discordAllowedGuilds: string; setDiscordAllowedGuilds: (v: string) => void;
  feishuAppId: string; setFeishuAppId: (v: string) => void;
  feishuAppSecret: string; setFeishuAppSecret: (v: string) => void;
  feishuRegion: string; setFeishuRegion: (v: string) => void;
  qqBotAppId: string; setQqBotAppId: (v: string) => void;
  qqBotSecret: string; setQqBotSecret: (v: string) => void;
  qqBotAllowedUsers: string; setQqBotAllowedUsers: (v: string) => void;
  qqBotAllowedGuilds: string; setQqBotAllowedGuilds: (v: string) => void;
  qqBotAllowedChannels: string; setQqBotAllowedChannels: (v: string) => void;
  whatsappPhoneNumberId: string; setWhatsappPhoneNumberId: (v: string) => void;
  whatsappAccessToken: string; setWhatsappAccessToken: (v: string) => void;
  whatsappAllowedUsers: string; setWhatsappAllowedUsers: (v: string) => void;
  whatsappAllowedChannels: string; setWhatsappAllowedChannels: (v: string) => void;
  slackBotToken: string; setSlackBotToken: (v: string) => void;
  slackSigningSecret: string; setSlackSigningSecret: (v: string) => void;
  slackAppToken: string; setSlackAppToken: (v: string) => void;
  dingtalkAppKey: string; setDingtalkAppKey: (v: string) => void;
  dingtalkAppSecret: string; setDingtalkAppSecret: (v: string) => void;
  dingtalkRobotSecret: string; setDingtalkRobotSecret: (v: string) => void;
  dingtalkAllowedUsers: string; setDingtalkAllowedUsers: (v: string) => void;
  dingtalkAllowedChats: string; setDingtalkAllowedChats: (v: string) => void;
  wechatMpAppId: string; setWechatMpAppId: (v: string) => void;
  wechatMpAppSecret: string; setWechatMpAppSecret: (v: string) => void;
  wechatMpToken: string; setWechatMpToken: (v: string) => void;
  wechatMpEncodingAesKey: string; setWechatMpEncodingAesKey: (v: string) => void;
  wechatMpAllowedUsers: string; setWechatMpAllowedUsers: (v: string) => void;
  wechatMpAllowedChats: string; setWechatMpAllowedChats: (v: string) => void;
  wecomAppId: string; setWecomAppId: (v: string) => void;
  wecomAppSecret: string; setWecomAppSecret: (v: string) => void;
  wecomToken: string; setWecomToken: (v: string) => void;
  wecomEncodingAesKey: string; setWecomEncodingAesKey: (v: string) => void;
  wecomAgentId: string; setWecomAgentId: (v: string) => void;
  wecomAllowedUsers: string; setWecomAllowedUsers: (v: string) => void;
  wecomAllowedChats: string; setWecomAllowedChats: (v: string) => void;
  weixinAccountId: string; setWeixinAccountId: (v: string) => void;
  weixinToken: string; setWeixinToken: (v: string) => void;
  weixinBaseUrl: string; setWeixinBaseUrl: (v: string) => void;
  weixinAllowedUsers: string; setWeixinAllowedUsers: (v: string) => void;
  weixinAllowedChats: string; setWeixinAllowedChats: (v: string) => void;
  webhookUrl: string; setWebhookUrl: (v: string) => void;
  webhookSecret: string; setWebhookSecret: (v: string) => void;
}

const CHANNEL_OPTIONS = [
  { value: "web", labelKey: "settings_channel_option_web" },
  { value: "telegram", labelKey: "settings_channel_option_telegram" },
  { value: "feishu", labelKey: "settings_channel_option_feishu" },
  { value: "weixin", labelKey: "settings_channel_option_weixin" },
  { value: "slack", labelKey: "settings_channel_option_slack" },
  { value: "webhook", labelKey: "settings_channel_option_webhook" },
  { value: "api", labelKey: "settings_channel_option_api" },
];

export function AppSettingsChannelSection(props: ChannelSectionProps) {
  const { channel, setChannel, externalChannelsAllowed = false } = props;
  const { t } = useTranslation("dashboard");
  const [qrSession, setQrSession] = useState<any>(null);
  const [qrBusy, setQrBusy] = useState(false);
  const [qrError, setQrError] = useState("");

  useEffect(() => {
    if (!qrSession?.id || qrSession.status !== "pending") return;
    const timer = window.setInterval(async () => {
      try {
        const response = await apiFetch("/api/instances/channel-onboarding/qr/" + encodeURIComponent(qrSession.id));
        const next = response?.session;
        if (!next) return;
        setQrSession(next);
        if (next.status === "completed" && next.result) {
          if (next.result.feishuAppId) props.setFeishuAppId(next.result.feishuAppId);
          if (next.result.feishuAppSecret) props.setFeishuAppSecret(next.result.feishuAppSecret);
          if (next.result.feishuRegion) props.setFeishuRegion(next.result.feishuRegion);
          if (next.result.weixinAccountId) props.setWeixinAccountId(next.result.weixinAccountId);
          if (next.result.weixinToken) props.setWeixinToken(next.result.weixinToken);
          if (next.result.weixinBaseUrl) props.setWeixinBaseUrl(next.result.weixinBaseUrl);
        }
      } catch (error: any) {
        setQrError(error?.message || t("settings_qr_poll_failed"));
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [qrSession?.id, qrSession?.status]);

  const startQr = async (target: "feishu" | "lark" | "weixin") => {
    setQrBusy(true);
    setQrError("");
    try {
      const response = await apiFetch("/api/instances/channel-onboarding/" + target + "/qr/start", { method: "POST" });
      setQrSession(response?.session || null);
    } catch (error: any) {
      setQrError(error?.message || t("settings_qr_start_failed"));
    } finally {
      setQrBusy(false);
    }
  };

  const renderQrPanel = (target: "feishu" | "lark" | "weixin") => {
    const active = qrSession?.channel === target;
    const completed = active && qrSession?.status === "completed";
    return (
      <div className="rounded-lg border border-indigo-100 dark:border-indigo-900/50 bg-indigo-50/60 dark:bg-indigo-950/20 p-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-medium text-indigo-900 dark:text-indigo-200">{t("settings_qr_title")}</div>
            <div className="mt-1 text-xs text-indigo-700 dark:text-indigo-300">{t(target === "weixin" ? "settings_qr_weixin_desc" : "settings_qr_feishu_desc")}</div>
          </div>
          <button type="button" disabled={qrBusy} onClick={() => startQr(target)} className="shrink-0 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">{qrBusy ? t("settings_qr_generating") : active ? t("settings_qr_refresh") : t("settings_qr_generate")}</button>
        </div>
        {active && qrSession?.qrUrl && !completed && (
          <div className="flex items-center gap-3 rounded-md bg-white p-3 dark:bg-slate-950">
            <QRCodeSVG value={qrSession.qrUrl} size={132} />
            <div className="text-xs text-content-secondary"><div>{qrSession.status === "pending" ? t("settings_qr_waiting") : qrSession.message || qrSession.status}</div><div className="mt-1 text-content-muted">{t("settings_qr_expiry_hint")}</div></div>
          </div>
        )}
        {completed && <div className="rounded-md bg-emerald-50 p-2 text-xs text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">{t("settings_qr_success")}</div>}
        {active && ["failed", "expired", "cancelled"].includes(qrSession?.status) && <div className="text-xs text-red-600">{qrSession.message || t("settings_qr_failed")}</div>}
        {qrError && <div className="text-xs text-red-600">{qrError}</div>}
      </div>
    );
  };
  const isCurrentChannelAllowed = isDeployChannelAllowedByEntitlement(channel, externalChannelsAllowed);

  return (
    <div className="p-4 bg-surface border border-slate-200/80 dark:border-slate-800 rounded-xl space-y-4 shadow-sm">
      <h4 className="text-[13px] font-semibold uppercase tracking-wider text-content-muted">{t("settings_channel_section_title")}</h4>

      {!isCurrentChannelAllowed && (
        <div className="p-3 bg-red-50 dark:bg-red-950/20 text-red-800 dark:text-red-300 text-[13px] rounded-lg border border-red-200/40 dark:border-red-900/40 leading-relaxed space-y-1">
          <div className="font-semibold flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5" />
            <span>{t("settings_channel_disabled_title", { channel })}</span>
          </div>
          <p>{t("settings_channel_disabled_description")}</p>
        </div>
      )}

      <div>
        <Label>{t("settings_channel_activate")}</Label>
        <select
          value={channel}
          onChange={e => setChannel(e.target.value)}
          className="flex h-9 w-full rounded-md border border-outline bg-surface px-3 text-sm text-content focus:ring-1 focus:ring-blue-500 mt-1"
        >
          {CHANNEL_OPTIONS.map(opt => {
            const allowed = isDeployChannelAllowedByEntitlement(opt.value, externalChannelsAllowed);
            return (
              <option
                key={opt.value}
                value={opt.value}
                disabled={!allowed}
              >
                {t(opt.labelKey)}
                {!allowed ? t("settings_channel_unavailable_suffix") : ""}
              </option>
            );
          })}
        </select>
      </div>

      {channel === 'telegram' && (
        <div className="p-3 bg-surface-muted border border-outline/80 rounded-lg space-y-3.5 text-[13px] animate-in slide-in-from-top-1 text-slate-800 dark:text-slate-200">
          <div>
            <Label className="text-[13px] text-content-secondary">{t("settings_channel_bot_token")}</Label>
            <Input
              type="password"
              placeholder={t("settings_channel_keep_current")}
              value={props.telegramBotToken}
              onChange={e => props.setTelegramBotToken(e.target.value)}
              className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
            />
          </div>
          <div>
            <Label className="text-[13px] text-content-secondary">{t("settings_channel_allowed_user_ids")}</Label>
            <Input
              placeholder="123,456"
              value={props.telegramAllowedUsers}
              onChange={e => props.setTelegramAllowedUsers(e.target.value)}
              className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
            />
          </div>
        </div>
      )}

      {channel === 'discord' && (
        <div className="p-3 bg-surface-muted border border-outline/80 rounded-lg space-y-3.5 text-[13px] animate-in slide-in-from-top-1 text-slate-800 dark:text-slate-200">
          <div>
            <Label className="text-[13px] text-content-secondary">{t("settings_channel_bot_token")}</Label>
            <Input
              type="password"
              placeholder={t("settings_channel_keep_current")}
              value={props.discordBotToken}
              onChange={e => props.setDiscordBotToken(e.target.value)}
              className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
            />
          </div>
          <div>
            <Label className="text-[13px] text-content-secondary">{t("settings_channel_allowed_guilds")}</Label>
            <Input
              placeholder="IDs..."
              value={props.discordAllowedGuilds}
              onChange={e => props.setDiscordAllowedGuilds(e.target.value)}
              className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
            />
          </div>
        </div>
      )}

      {channel === 'feishu' && (
        <div className="p-3 bg-surface-muted border border-outline/80 rounded-lg space-y-3.5 text-[13px] animate-in slide-in-from-top-1 text-slate-800 dark:text-slate-200">
          {renderQrPanel((props.feishuRegion || "feishu") === "lark" ? "lark" : "feishu")}
          <div>
            <Label className="text-[13px] text-content-secondary">{t("settings_channel_region")}</Label>
            <select
              value={props.feishuRegion || "feishu"}
              onChange={e => props.setFeishuRegion(e.target.value)}
              className="flex h-8 w-full rounded-md border border-outline bg-surface px-2 py-1 text-[13px] text-content mt-1 focus:ring-1 focus:ring-blue-500 focus:outline-none"
            >
              <option value="feishu">{t("settings_feishu_region_china")}</option>
              <option value="lark">{t("settings_feishu_region_global")}</option>
            </select>
          </div>
          <div>
            <Label className="text-[13px] text-content-secondary">{t("settings_channel_app_id")}</Label>
            <Input
              placeholder="cli_..."
              value={props.feishuAppId}
              onChange={e => props.setFeishuAppId(e.target.value)}
              className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
            />
          </div>
          <div>
            <Label className="text-[13px] text-content-secondary">{t("settings_channel_app_secret")}</Label>
            <Input
              type="password"
              placeholder={t("settings_channel_keep_current")}
              value={props.feishuAppSecret}
              onChange={e => props.setFeishuAppSecret(e.target.value)}
              className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
            />
          </div>
        </div>
      )}

      {channel === 'qq_bot' && (
        <div className="p-3 bg-surface-muted border border-outline/80 rounded-lg space-y-3.5 text-[13px] animate-in slide-in-from-top-1 text-slate-800 dark:text-slate-200">
          <div>
            <Label>{t("settings_channel_app_id")}</Label>
            <Input
              value={props.qqBotAppId}
              onChange={e => props.setQqBotAppId(e.target.value)}
              className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
            />
          </div>
          <div>
            <Label>{t("settings_channel_secret")}</Label>
            <Input
              type="password"
              value={props.qqBotSecret}
              onChange={e => props.setQqBotSecret(e.target.value)}
              className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
            />
          </div>
          <div>
            <Label>{t("settings_channel_allowed_users")}</Label>
            <Input value={props.qqBotAllowedUsers} onChange={e => props.setQqBotAllowedUsers(e.target.value)} className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1" />
          </div>
          <div>
            <Label>{t("settings_channel_allowed_guilds")}</Label>
            <Input value={props.qqBotAllowedGuilds} onChange={e => props.setQqBotAllowedGuilds(e.target.value)} className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1" />
          </div>
        </div>
      )}

      {channel === 'whatsapp' && (
        <div className="p-3 bg-surface-muted border border-outline/80 rounded-lg space-y-3.5 text-[13px] animate-in slide-in-from-top-1 text-slate-800 dark:text-slate-200">
          <div>
            <Label>{t("settings_channel_phone_id")}</Label>
            <Input
              value={props.whatsappPhoneNumberId}
              onChange={e => props.setWhatsappPhoneNumberId(e.target.value)}
              className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
            />
          </div>
          <div>
            <Label>{t("settings_channel_access_token")}</Label>
            <Input
              type="password"
              value={props.whatsappAccessToken}
              onChange={e => props.setWhatsappAccessToken(e.target.value)}
              className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
            />
          </div>
          <div>
            <Label>{t("settings_channel_allowed_users")}</Label>
            <Input value={props.whatsappAllowedUsers} onChange={e => props.setWhatsappAllowedUsers(e.target.value)} className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1" />
          </div>
        </div>
      )}

      {channel === 'slack' && (
        <div className="p-3 bg-surface-muted border border-outline/80 rounded-lg space-y-3.5 text-[13px] animate-in slide-in-from-top-1 text-slate-800 dark:text-slate-200">
          <div>
            <Label>{t("settings_channel_bot_token")}</Label>
            <Input
              type="password"
              value={props.slackBotToken}
              onChange={e => props.setSlackBotToken(e.target.value)}
              className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
            />
          </div>
          <div>
            <Label>{t("settings_channel_signing_secret")}</Label>
            <Input
              type="password"
              value={props.slackSigningSecret}
              onChange={e => props.setSlackSigningSecret(e.target.value)}
              className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
            />
          </div>
          <div>
            <Label>{t("settings_channel_app_token")}</Label>
            <Input
              type="password"
              value={props.slackAppToken}
              onChange={e => props.setSlackAppToken(e.target.value)}
              className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
            />
          </div>
        </div>
      )}

      {channel === 'dingtalk' && (
        <div className="p-3 bg-surface-muted border border-outline/80 rounded-lg space-y-3.5 text-[13px] animate-in slide-in-from-top-1 text-slate-800 dark:text-slate-200">
          <div className="text-[13px] text-amber-600 bg-amber-50 p-2 border border-amber-100 rounded leading-relaxed">
            <strong>{t("settings_channel_beta_notice")}</strong>{t("settings_dingtalk_beta_description")}<br/>
            <strong>{t("settings_event_callback_url")}</strong><code className="bg-surface px-1.5 py-0.5 rounded border border-outline text-[11px] select-all text-slate-800 dark:text-slate-200">{t("settings_callback_url_template", { path: "dingtalk" })}</code>
          </div>
          <div>
            <Label>{t("settings_channel_app_key")}</Label>
            <Input
              value={props.dingtalkAppKey}
              onChange={e => props.setDingtalkAppKey(e.target.value)}
              className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
            />
          </div>
          <div>
            <Label>{t("settings_channel_app_secret")}</Label>
            <Input
              type="password"
              value={props.dingtalkAppSecret}
              onChange={e => props.setDingtalkAppSecret(e.target.value)}
              className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
            />
          </div>
          <div>
            <Label>{t("settings_channel_allowed_users")}</Label>
            <Input value={props.dingtalkAllowedUsers} onChange={e => props.setDingtalkAllowedUsers(e.target.value)} className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1" />
          </div>
        </div>
      )}

      {channel === 'wechat_mp' && (
        <div className="p-3 bg-surface-muted border border-outline/80 rounded-lg space-y-3.5 text-[13px] animate-in slide-in-from-top-1 text-slate-800 dark:text-slate-200">
          <div className="text-[13px] text-amber-600 bg-amber-50 p-2 border border-amber-100 rounded leading-relaxed">
            <strong>{t("settings_channel_beta_notice")}</strong>{t("settings_wechat_mp_beta_description")}<br/>
            <strong>{t("settings_server_callback_url")}</strong><code className="bg-surface px-1.5 py-0.5 rounded border border-outline text-[11px] select-all text-slate-800 dark:text-slate-200">{t("settings_callback_url_template", { path: "wechat_mp" })}</code>
          </div>
          <div>
            <Label>{t("settings_channel_app_id")}</Label>
            <Input
              value={props.wechatMpAppId}
              onChange={e => props.setWechatMpAppId(e.target.value)}
              className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
            />
          </div>
          <div>
            <Label>{t("settings_channel_app_secret")}</Label>
            <Input
              type="password"
              value={props.wechatMpAppSecret}
              onChange={e => props.setWechatMpAppSecret(e.target.value)}
              className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
            />
          </div>
          <div>
            <Label>{t("settings_wechat_mp_token")}</Label>
            <Input
              type="password"
              value={props.wechatMpToken}
              onChange={e => props.setWechatMpToken(e.target.value)}
              placeholder={t("settings_channel_custom_token")}
              className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
            />
          </div>
          <div>
            <Label>{t("settings_wechat_mp_aes_key")}</Label>
            <Input
              type="password"
              value={props.wechatMpEncodingAesKey}
              onChange={e => props.setWechatMpEncodingAesKey(e.target.value)}
              placeholder={t("settings_wechat_mp_aes_key_placeholder")}
              className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
            />
          </div>
          <div>
            <Label>{t("settings_channel_allowed_users")}</Label>
            <Input value={props.wechatMpAllowedUsers} onChange={e => props.setWechatMpAllowedUsers(e.target.value)} className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1" />
          </div>
        </div>
      )}

      {channel === 'wecom' && (
        <div className="p-3 bg-surface-muted border border-outline/80 rounded-lg space-y-3.5 text-[13px] animate-in slide-in-from-top-1 text-slate-800 dark:text-slate-200">
          <div className="text-[13px] text-amber-600 bg-amber-50 p-2 border border-amber-100 rounded leading-relaxed">
            <strong>{t("settings_channel_beta_notice")}</strong>{t("settings_wecom_beta_description")}<br/>
            <strong>{t("settings_message_server_url")}</strong><code className="bg-surface px-1.5 py-0.5 rounded border border-outline text-[11px] select-all text-slate-800 dark:text-slate-200">{t("settings_callback_url_template", { path: "wecom" })}</code>
          </div>
          <div>
            <Label>{t("settings_channel_corp_id")}</Label>
            <Input
              value={props.wecomAppId}
              onChange={e => props.setWecomAppId(e.target.value)}
              className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
            />
          </div>
          <div>
            <Label>{t("settings_channel_secret")}</Label>
            <Input
              type="password"
              value={props.wecomAppSecret}
              onChange={e => props.setWecomAppSecret(e.target.value)}
              className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
            />
          </div>
          <div>
            <Label>{t("settings_channel_agent_id")}</Label>
            <Input
              value={props.wecomAgentId}
              onChange={e => props.setWecomAgentId(e.target.value)}
              className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
            />
          </div>
          <div>
            <Label>{t("settings_wecom_token")}</Label>
            <Input
              type="password"
              value={props.wecomToken}
              onChange={e => props.setWecomToken(e.target.value)}
              placeholder={t("settings_channel_custom_token")}
              className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
            />
          </div>
          <div>
            <Label>{t("settings_wecom_aes_key")}</Label>
            <Input
              type="password"
              value={props.wecomEncodingAesKey}
              onChange={e => props.setWecomEncodingAesKey(e.target.value)}
              placeholder={t("settings_wecom_aes_key_placeholder")}
              className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
            />
          </div>
        </div>
      )}

      {channel === 'weixin' && (
        <div className="p-3 bg-surface-muted border border-outline/80 rounded-lg space-y-3.5 text-[13px] animate-in slide-in-from-top-1 text-slate-800 dark:text-slate-200">
          {renderQrPanel("weixin")}
          <div>
            <Label>{t("settings_weixin_account_id")}</Label>
            <Input value={props.weixinAccountId} onChange={e => props.setWeixinAccountId(e.target.value)} placeholder={t("settings_weixin_scan_fill")} className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1" autoComplete="off" />
          </div>
          <div>
            <Label>{t("settings_weixin_token")}</Label>
            <Input type="password" value={props.weixinToken} onChange={e => props.setWeixinToken(e.target.value)} placeholder={t("settings_weixin_token_placeholder")} className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1" autoComplete="new-password" data-lpignore="true" data-1p-ignore="true" />
          </div>
          <div>
            <Label>{t("settings_weixin_base_url")}</Label>
            <Input value={props.weixinBaseUrl} onChange={e => props.setWeixinBaseUrl(e.target.value)} placeholder={t("settings_weixin_base_url_placeholder")} className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1" autoComplete="off" />
          </div>
          <div>
            <Label>{t("settings_weixin_allowed_users")}</Label>
            <Input value={props.weixinAllowedUsers} onChange={e => props.setWeixinAllowedUsers(e.target.value)} placeholder={t("settings_weixin_allowlist_placeholder")} className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1" />
          </div>
          <div>
            <Label>{t("settings_weixin_allowed_chats")}</Label>
            <Input value={props.weixinAllowedChats} onChange={e => props.setWeixinAllowedChats(e.target.value)} placeholder={t("settings_weixin_allowlist_placeholder")} className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1" />
          </div>
        </div>
      )}
      {channel === 'webhook' && (
        <div className="p-3 bg-surface-muted border border-outline/80 rounded-lg space-y-3.5 text-[13px] animate-in slide-in-from-top-1 text-slate-800 dark:text-slate-200">
          <div>
            <Label>{t("settings_channel_url")}</Label>
            <Input
              value={props.webhookUrl}
              onChange={e => props.setWebhookUrl(e.target.value)}
              className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
            />
          </div>
          <div>
            <Label>{t("settings_channel_secret")}</Label>
            <Input
              type="password"
              value={props.webhookSecret}
              onChange={e => props.setWebhookSecret(e.target.value)}
              className="h-8 bg-surface dark:text-slate-100 dark:border-slate-800 mt-1"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
            />
          </div>
          <div className="text-[13px] leading-relaxed text-content-muted bg-surface/60 p-2 rounded border border-outline">
            {t("settings_webhook_endpoint_description", { url: t("settings_webhook_public_url") })}
          </div>
        </div>
      )}

      {channel === 'api' && (
        <div className="p-3 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 rounded-lg text-[13px] text-blue-800 dark:text-blue-300 space-y-2 animate-in slide-in-from-top-1">
          <div>{t("channel_api_desc")}</div>
          <div className="text-[13px] leading-relaxed text-content-muted bg-surface/60 p-2 rounded border border-outline">
            {t("settings_api_endpoint_description", { url: t("settings_api_public_url") })}
          </div>
        </div>
      )}

      <ChannelWebhookHelper
        channel={channel}
        feishuAppId={props.feishuAppId}
        feishuAppSecret={props.feishuAppSecret}
        dingtalkAppKey={props.dingtalkAppKey}
        dingtalkAppSecret={props.dingtalkAppSecret}
        telegramBotToken={props.telegramBotToken}
        qqBotAppId={props.qqBotAppId}
      />
    </div>
  );
}
