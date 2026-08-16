import { Bot, AlertTriangle, CheckCircle2, Loader2, BookOpen, Globe, Shield, ShieldAlert } from "lucide-react";
import { Label, Button, Card } from "../../components/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChannelSetupGuidePanel } from "./ChannelSetupGuidePanel";
import { ChannelManualConfigForm } from "./ChannelManualConfigForm";
import { ChannelSelector } from "./ChannelSelector";

interface ChannelStepProps {
  data: any;
  update: (k: any, v: any) => void;
  testChannel: () => Promise<void>;
  testStatus: any;
  onViewGuide?: (guideId: string) => void;
  versions?: any[];
  handleChannelChange?: (channel: string) => void;
  externalChannelsAllowed?: boolean;
  isChannelAllowed?: (channel: string) => boolean;
  planLabel?: string;
  channelRestrictionMessage?: string;
}

export function ChannelStep({ data, update, testChannel, testStatus, onViewGuide, versions = [], handleChannelChange, externalChannelsAllowed = true, isChannelAllowed, planLabel, channelRestrictionMessage }: ChannelStepProps) {
  const { t } = useTranslation("deploy");
  const [showGuide, setShowGuide] = useState(true);

  const isTesting = testStatus?.loading;
  const isTestSuccess = testStatus?.result?.success;
  const currentMode = data.channelMode || "testing";

  const isChannelConfigured = () => {
    if (!data.channel || data.channel === "none" || data.channel === "web") return false;
    if (data.channel === "telegram") return !(!data.telegramBotToken);
    if (data.channel === "feishu") return !(!data.feishuAppId || !data.feishuAppSecret);
    if (data.channel === "weixin") return !(!data.weixinAccountId || !data.weixinToken);
    if (data.channel === "slack") return !(!data.slackBotToken);
    if (data.channel === "discord") return !(!data.discordBotToken);
    if (data.channel === "webhook") return !(!data.webhookUrl);
    if (data.channel === "whatsapp") return !(!data.whatsappPhoneNumberId || !data.whatsappAccessToken);
    if (data.channel === "dingtalk") return !(!data.dingtalkAppKey || !data.dingtalkAppSecret);
    if (data.channel === "qq_bot") return !(!data.qqBotAppId || !data.qqBotSecret);
    if (data.channel === "wechat_mp") return !(!data.wechatMpAppId || !data.wechatMpAppSecret);
    if (data.channel === "wecom") return !(!data.wecomAppId || !data.wecomAppSecret || !data.wecomAgentId);
    return false;
  };

  const isAllowlistEmpty = () => {
    if ((data.allowMode || "bind_later") !== "allowlist") return false;
    if (data.gatewayAllowAllUsers) return false;
    if (data.channel === "none" || data.channel === "web") return false;
    if (data.channel === "telegram") return !(data.telegramAllowedUsers || "").trim() && !(data.telegramAllowedChats || "").trim();
    if (data.channel === "feishu") return !(data.feishuAllowedUsers || "").trim() && !(data.feishuAllowedChats || "").trim();
    if (data.channel === "weixin") return !(data.weixinAllowedUsers || "").trim() && !(data.weixinAllowedChats || "").trim();
    if (data.channel === "slack") return !(data.slackAllowedUsers || "").trim() && !(data.slackAllowedChannels || "").trim();
    if (data.channel === "discord") return !(data.discordAllowedGuilds || "").trim() && !(data.discordAllowedUsers || "").trim() && !(data.discordAllowedChannels || "").trim();
    if (data.channel === "webhook") return !(data.webhookAllowedUsers || "").trim() && !(data.webhookAllowedChannels || "").trim();
    if (data.channel === "whatsapp") return !(data.whatsappAllowedUsers || "").trim() && !(data.whatsappAllowedChannels || "").trim();
    if (data.channel === "dingtalk") return !(data.dingtalkAllowedUsers || "").trim() && !(data.dingtalkAllowedChats || "").trim();
    if (data.channel === "qq_bot") return !(data.qqBotAllowedUsers || "").trim() && !(data.qqBotAllowedGuilds || "").trim() && !(data.qqBotAllowedChannels || "").trim();
    if (data.channel === "wechat_mp") return !(data.wechatMpAllowedUsers || "").trim() && !(data.wechatMpAllowedChats || "").trim();
    if (data.channel === "wecom") return !(data.wecomAllowedUsers || "").trim() && !(data.wecomAllowedChats || "").trim();
    return false;
  };

  const showEmptyWarning = isAllowlistEmpty();
  const restrictionMessage = channelRestrictionMessage || t("wizardCopy.channel.restricted");

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="border-b border-outline pb-3 flex flex-col sm:flex-row gap-3.5 sm:items-center justify-between">
        <div className="space-y-0.5">
          <h4 className="text-base font-bold text-content flex items-center gap-1.5">
            <Bot className="w-5 h-5 text-blue-600" />
            <span>{t("wizardCopy.channel.title")}</span>
          </h4>
          <p className="text-[13px] text-content-muted">
            {t("wizardCopy.channel.description")}
          </p>
        </div>

        {data.channel && data.channel !== "none" && data.channel !== "web" && (
          <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowGuide(!showGuide)}
              className="h-9 px-3.5 text-[13px] font-semibold gap-1.5 border-outline text-content-secondary bg-surface hover:bg-surface-muted shrink-0 font-sans"
            >
              <BookOpen className="w-3.5 h-3.5 text-blue-500" />
              <span>{showGuide ? t("wizardCopy.channel.hideGuide") : t("wizardCopy.channel.showGuide")}</span>
            </Button>

            <Button
              type="button"
              onClick={testChannel}
              disabled={isTesting || !isChannelConfigured()}
              variant={isTestSuccess ? "outline" : "primary"}
              className={`h-9 px-4 text-[13px] font-semibold shrink-0 gap-1.5 ${isTestSuccess ? "border-green-200 bg-green-50/50 text-green-700 hover:text-green-850 dark:border-emerald-800/70 dark:bg-emerald-950/35 dark:text-emerald-300 dark:hover:text-emerald-200" : ""}`}
            >
              {isTesting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{t("wizardCopy.channel.connecting")}</span>
                </>
              ) : isTestSuccess ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                  <span>{t("wizardCopy.channel.connected")}</span>
                </>
              ) : (
                <>
                  <Globe className="w-3.5 h-3.5" />
                  <span>{t("wizardCopy.channel.test")}</span>
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {testStatus?.result && data.channel !== "none" && data.channel !== "web" && (
        <div className={`p-3.5 rounded-xl border flex items-start gap-2.5 text-[13px] animate-in fade-in duration-200 ${
          isTestSuccess
            ? "border-green-200 bg-green-50/50 text-green-800 dark:border-emerald-800/70 dark:bg-emerald-950/35 dark:text-emerald-200"
            : "border-red-200 bg-red-50/50 text-red-800 dark:border-red-900/70 dark:bg-red-950/35 dark:text-red-200"
        }`}>
          {isTestSuccess ? (
            <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-red-650 shrink-0 mt-0.5 animate-bounce" />
          )}
          <div className="space-y-1">
            <p className="font-bold">
              {isTestSuccess ? t("wizardCopy.channel.success") : t("wizardCopy.channel.failure")}
            </p>
            <p className="opacity-95 leading-relaxed font-mono text-[13px] whitespace-pre-wrap">
              {testStatus.result.message || testStatus.result.error || t("wizardCopy.channel.timeout")}
            </p>
          </div>
        </div>
      )}

      {!externalChannelsAllowed && !isChannelAllowed && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-[13px] leading-relaxed text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/35 dark:text-amber-200">
          External channels are disabled in this local deployment. Enable them in the local configuration before selecting an IM channel.
        </div>
      )}

      <ChannelSelector
        selectedId={data.channel}
        externalChannelsAllowed={externalChannelsAllowed}
        isChannelAllowed={isChannelAllowed}
        lockedMessage={restrictionMessage}
        onSelect={(id) => {
          if (handleChannelChange) {
            handleChannelChange(id);
          } else {
            update("channel", id);
            if (id === "none" || id === "web") update("gatewayAllowAllUsers", false);
          }
        }}
      />

      {(data.channel === "feishu" || data.channel === "lark") && (() => {
        const selectedVer = versions?.find(v => {
          if (v.image_tag === data.imageTag || v.tag === data.imageTag || v.version === data.imageTag) return true;
          if (v.coreVariant?.tag === data.imageTag || v.feishuVariant?.tag === data.imageTag) return true;
          return false;
        });
        const isLatest = !data.imageTag || data.imageTag === "latest";
        const isVerFeishu = !!(
          data.imageTag && typeof data.imageTag === 'string' && (
            data.imageTag.toLowerCase().includes("feishu") ||
            data.imageTag.toLowerCase().includes("lark")
          )
        );

        const recommendedFeishuVer = versions?.find(v =>
          (v.capabilities?.includes("feishu") || v.feishu_capable === true) &&
          (v.tag?.toLowerCase().includes("feishu") || (v.image_tag || v.tag)?.toLowerCase().includes("feishu"))
        );

        return (
          <div className="p-4 border rounded-xl animate-in fade-in zoom-in-95 duration-250 space-y-3 bg-surface-muted border-outline text-content text-left">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0 rounded-lg bg-blue-100 p-2 text-blue-600 dark:bg-blue-950/70 dark:text-blue-300">
                <Shield className="w-4 h-4" />
              </div>
              <div className="text-[13px] space-y-1">
                <strong className="block text-sm font-bold text-content">{t("wizardCopy.channel.feishuGuideTitle")}</strong>
                <p className="text-content-secondary leading-relaxed">
                  {t("wizardCopy.channel.feishuGuideDescription")}
                  {t("wizardCopy.channel.feishuImageHint")}
                </p>
              </div>
            </div>

            <div className="border-t border-outline pt-3">
              {isLatest ? (
                <div className="flex flex-col justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800/70 dark:bg-amber-950/35 sm:flex-row sm:items-center">
                  <div className="flex items-start gap-2 text-left text-[13px] text-amber-900 dark:text-amber-200">
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">{t("wizardCopy.channel.latestWarningTitle")}</span>
                      <p className="mt-0.5 text-[13px] text-amber-800 dark:text-amber-300">
                        {t("wizardCopy.channel.latestWarningDescription")}
                      </p>
                    </div>
                  </div>
                  {recommendedFeishuVer && (
                    <button
                      type="button"
                      onClick={() => {
                        update("imageTag", recommendedFeishuVer.image_tag || recommendedFeishuVer.tag);
                      }}
                      className="shrink-0 text-[13px] px-3 py-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 font-bold text-white rounded-lg transition-colors cursor-pointer select-none"
                    >
                      {t("wizardCopy.channel.switchRecommended", { tag: recommendedFeishuVer.tag })}
                    </button>
                  )}
                </div>
              ) : isVerFeishu ? (
                <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-left text-[13px] text-emerald-900 dark:border-emerald-800/70 dark:bg-emerald-950/35 dark:text-emerald-200">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">{t("wizardCopy.channel.feishuSupportedTitle")}</span>
                    <p className="mt-0.5 text-[13px] text-emerald-800 dark:text-emerald-300">
                      {t("wizardCopy.channel.feishuSupportedDescription", { tag: data.imageTag })}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-900/70 dark:bg-rose-950/35 sm:flex-row sm:items-center">
                  <div className="flex items-start gap-2 text-left text-[13px] text-rose-900 dark:text-rose-200">
                    <AlertTriangle className="w-4 h-4 text-rose-550 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">{t("wizardCopy.channel.incompatibleTitle")}</span>
                      <p className="mt-0.5 text-[13px] text-rose-800 dark:text-rose-300">
                        {t("wizardCopy.channel.incompatibleDescription", { tag: data.imageTag })}
                      </p>
                    </div>
                  </div>
                  {recommendedFeishuVer && (
                    <button
                      type="button"
                      onClick={() => {
                        update("imageTag", recommendedFeishuVer.image_tag || recommendedFeishuVer.tag);
                      }}
                      className="shrink-0 text-[13px] px-3 py-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 font-bold text-white rounded-lg transition-colors cursor-pointer select-none"
                    >
                      {t("wizardCopy.channel.forceRecommended", { tag: recommendedFeishuVer.tag })}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {data.channel !== "none" && data.channel !== "web" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className={`${showGuide ? "lg:col-span-2" : "lg:col-span-3"} space-y-6 transition-all duration-300`}>
            {/* 1. Security Strategy */}
            <div className="bg-surface p-5 rounded-xl border border-outline shadow-sm space-y-4">
              <div className="flex items-center gap-1.5 border-b border-outline pb-2.5">
                <Shield className="w-4 h-4 text-blue-600" />
                <Label className="text-[13px] font-bold text-content">{t("wizardCopy.channel.accessPolicy")}</Label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  {
                    id: "bind_later",
                    icon: "✨",
                    title: t("wizardCopy.channel.bindLaterTitle"),
                    desc: t("wizardCopy.channel.bindLaterDesc")
                  },
                  {
                    id: "allowlist",
                    icon: "🛡️",
                    title: t("wizardCopy.channel.allowlistTitle"),
                    desc: t("wizardCopy.channel.allowlistDesc")
                  },
                  {
                    id: "allow_all",
                    icon: "🌐",
                    title: t("wizardCopy.channel.allowAllTitle"),
                    desc: t("wizardCopy.channel.allowAllDesc")
                  },
                  {
                    id: "disabled",
                    icon: "❌",
                    title: t("wizardCopy.channel.disabledTitle"),
                    desc: t("wizardCopy.channel.disabledDesc")
                  }
                ].map((item) => {
                  const activeMode = data.allowMode || "bind_later";
                  const isSelected = activeMode === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        update("allowMode", item.id);
                        update("channelMode", item.id === "allow_all" ? "testing" : "production");
                        update("gatewayAllowAllUsers", item.id === "allow_all");
                      }}
                      className={`p-3.5 rounded-xl border text-left flex flex-col justify-between transition-all cursor-pointer active:scale-98 ${
                        isSelected
                          ? "border-blue-500 bg-blue-50/70 text-blue-950 ring-1 ring-blue-500/10 font-bold dark:border-blue-400 dark:bg-blue-950/45 dark:text-blue-100 dark:ring-blue-400/20"
                          : "border-outline bg-surface hover:bg-surface-muted text-content-secondary"
                      }`}
                    >
                      <span className="text-[13px] font-bold flex items-center gap-1.5">
                        <span>{item.icon}</span>
                        <span>{item.title}</span>
                      </span>
                      <span className="text-[11px] text-content-muted mt-1.5 leading-relaxed font-normal">
                        {item.desc}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Informational Alerts based on selected mode */}
              {(data.allowMode || "bind_later") === "bind_later" && (
                <div className="flex items-start gap-2.5 rounded-xl border border-blue-200 bg-blue-50/70 p-3.5 text-left text-[13px] animate-in fade-in duration-200 dark:border-blue-800/70 dark:bg-blue-950/35">
                  <CheckCircle2 className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <p className="font-bold text-blue-800 dark:text-blue-300">{t("wizardCopy.channel.autoBindTitle")}</p>
                    <p className="text-content-secondary leading-relaxed text-[13px]">
                      {t("wizardCopy.channel.autoBindStep1")}
                      {t("wizardCopy.channel.autoBindStep2")}
                      {t("wizardCopy.channel.autoBindStep3")}
                    </p>
                  </div>
                </div>
              )}

              {(data.allowMode) === "allow_all" && (
                <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-left text-[13px] animate-in fade-in duration-200 dark:border-amber-800/70 dark:bg-amber-950/30">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5 animate-pulse" />
                  <div className="space-y-0.5">
                    <p className="font-bold text-amber-800 dark:text-amber-300">{t("wizardCopy.channel.allowAllWarningTitle")}</p>
                    <p className="text-content-secondary leading-relaxed text-[13px]">
                      {t("wizardCopy.channel.allowAllWarning")}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* 2. Manual Config */}
            <Card className="p-5 border-outline bg-surface rounded-xl shadow-sm space-y-4">
              <div className="mb-1 flex items-center justify-between border-b border-outline bg-surface pb-2.5">
                <div className="flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-blue-600" />
                  <span className="text-[13px] font-bold text-content uppercase tracking-tight">{t("wizardCopy.channel.credentials")}</span>
                </div>
                <span className={`text-[11px] px-2.5 py-0.5 rounded-md font-bold border ${currentMode === "production" ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/35 dark:text-emerald-300" : "border-blue-250 bg-blue-50 text-blue-700 animate-pulse dark:border-blue-800/70 dark:bg-blue-950/35 dark:text-blue-300"}`}>
                  {currentMode === "production" ? t("wizardCopy.channel.production") : t("wizardCopy.channel.testing")}
                </span>
              </div>
              <ChannelManualConfigForm channel={data.channel} data={data} update={update} />

              {/* Mobile-friendly bottom testing connection action row */}
              <div className="pt-4 border-t border-outline flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-[13px] bg-surface-muted/50 -mx-5 -mb-5 p-4 rounded-b-xl border-dashed">
                <div className="space-y-0.5 text-left">
                  <p className="font-semibold text-content-secondary">{t("wizardCopy.channel.verifyTitle")}</p>
                  <p className="text-[11px] text-content-muted">{t("wizardCopy.channel.verifyDescription")}</p>
                </div>
                <Button
                  id="card-test-channel-btn"
                  type="button"
                  onClick={testChannel}
                  disabled={isTesting || !isChannelConfigured()}
                  variant={isTestSuccess ? "outline" : "primary"}
                  className={`h-9 px-4.5 text-[13px] font-semibold shrink-0 gap-1.5 w-full sm:w-auto justify-center ${isTestSuccess ? "border-green-200 bg-green-50/50 text-green-700 hover:text-green-850 dark:border-emerald-800/70 dark:bg-emerald-950/35 dark:text-emerald-300 dark:hover:text-emerald-200" : ""}`}
                >
                  {isTesting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>{t("wizardCopy.channel.connecting")}</span>
                    </>
                  ) : isTestSuccess ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                      <span>{t("wizardCopy.channel.connected")}</span>
                    </>
                  ) : (
                    <>
                      <Globe className="w-3.5 h-3.5" />
                      <span>{t("wizardCopy.channel.test")}</span>
                    </>
                  )}
                </Button>
              </div>
            </Card>

            {/* Empty Warning */}
            {showEmptyWarning && (
              <div className="flex flex-col items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-[13px] text-rose-950 animate-in shake duration-300 dark:border-rose-900/70 dark:bg-rose-950/35 dark:text-rose-200 md:flex-row">
                <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5 animate-pulse" />
                <div className="space-y-1 text-left flex-1">
                  <p className="font-bold text-rose-800 dark:text-rose-300">{t("wizardCopy.channel.emptyAllowlistTitle")}</p>
                  <p className="opacity-95 leading-relaxed text-[13px]">{t("wizardCopy.channel.emptyAllowlistDescription")}</p>
                </div>
              </div>
            )}
          </div>

          {/* 3. Right Guide Panel */}
          {showGuide && (
             <div className="lg:col-span-1 space-y-4 animate-in slide-in-from-right-4 duration-300">
                <ChannelSetupGuidePanel channelId={data.channel} />
             </div>
          )}
        </div>
      )}
    </div>
  );
}
