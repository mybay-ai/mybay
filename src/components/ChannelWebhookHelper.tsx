import { useState } from "react";
import { Copy, Check, ShieldCheck, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui";

interface ChannelWebhookHelperProps {
  channel: string;
  instanceSlug?: string;
  hostDomain?: string;
  feishuAppId?: string;
  feishuAppSecret?: string;
  dingtalkAppKey?: string;
  dingtalkAppSecret?: string;
  telegramBotToken?: string;
  qqBotAppId?: string;
}

export function ChannelWebhookHelper({
  channel,
  instanceSlug = "your-agent-slug",
  hostDomain = window.location.host,
  feishuAppId = "",
  feishuAppSecret = "",
  dingtalkAppKey = "",
  dingtalkAppSecret = "",
  telegramBotToken = "",
  qqBotAppId = "",
}: ChannelWebhookHelperProps) {
  const [copied, setCopied] = useState(false);
  const { t } = useTranslation("deploy");

  const protocol = window.location.protocol;
  const baseUrl = `${protocol}//${hostDomain}`;

  // Build channel-specific webhook callback URL pattern
  const getWebhookUrl = () => {
    switch (channel) {
      case "feishu":
        return `${baseUrl}/api/channels/feishu/webhook/${instanceSlug}`;
      case "dingtalk":
        return `${baseUrl}/api/channels/dingtalk/webhook/${instanceSlug}`;
      case "telegram":
        return `${baseUrl}/api/channels/telegram/webhook/${instanceSlug}`;
      case "wechat_mp":
        return `${baseUrl}/api/channels/wechat/webhook/${instanceSlug}`;
      case "wecom":
        return `${baseUrl}/api/channels/wecom/webhook/${instanceSlug}`;
      case "qq_bot":
        return `${baseUrl}/api/channels/qq/webhook/${instanceSlug}`;
      case "slack":
        return `${baseUrl}/api/channels/slack/webhook/${instanceSlug}`;
      case "webhook":
        return `${baseUrl}/api/channels/generic/webhook/${instanceSlug}`;
      default:
        return `${baseUrl}/api/channels/${channel}/webhook/${instanceSlug}`;
    }
  };

  const webhookUrl = getWebhookUrl();

  const handleCopy = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Perform parameter format checks
  const getValidationErrors = (): string[] => {
    const errors: string[] = [];
    if (channel === "feishu") {
      if (feishuAppId && !feishuAppId.startsWith("cli_")) {
        errors.push(t("wizardCopy.webhookHelper.validation.feishuAppId"));
      }
      if (feishuAppSecret && feishuAppSecret.length < 16) {
        errors.push(t("wizardCopy.webhookHelper.validation.feishuAppSecret"));
      }
    } else if (channel === "dingtalk") {
      if (dingtalkAppKey && dingtalkAppKey.length < 8) {
        errors.push(t("wizardCopy.webhookHelper.validation.dingtalkAppKey"));
      }
    } else if (channel === "telegram") {
      if (telegramBotToken && !telegramBotToken.includes(":")) {
        errors.push(t("wizardCopy.webhookHelper.validation.telegramBotToken"));
      }
    } else if (channel === "qq_bot") {
      if (qqBotAppId && !/^\d+$/.test(qqBotAppId.trim())) {
        errors.push(t("wizardCopy.webhookHelper.validation.qqBotAppId"));
      }
    }
    return errors;
  };

  const validationErrors = getValidationErrors();

  if (["web", "none", "api"].includes(channel)) {
    return null;
  }

  return (
    <div className="mt-3 p-3.5 bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-900/40 rounded-lg text-xs space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-blue-900 dark:text-blue-300 flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <span>{t("wizardCopy.webhookHelper.title")}</span>
        </span>
        <span className="text-[11px] text-blue-700/80 dark:text-blue-400">{t("wizardCopy.webhookHelper.gatewayIsolated")}</span>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          readOnly
          value={webhookUrl}
          className="flex-1 font-mono text-[11px] bg-surface border border-blue-200 dark:border-slate-800 rounded px-2.5 py-1.5 text-slate-800 dark:text-slate-200 select-all"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleCopy}
          className="h-8 px-3 text-[11px] font-medium border-blue-200 text-blue-700 hover:bg-blue-100/50 dark:border-blue-800 dark:text-blue-300 gap-1 shrink-0"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-green-600" />
              <span>{t("wizardCopy.webhookHelper.copied")}</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 text-blue-600" />
              <span>{t("wizardCopy.webhookHelper.copy")}</span>
            </>
          )}
        </Button>
      </div>

      {validationErrors.length > 0 && (
        <div className="space-y-1 pt-1">
          {validationErrors.map((err, idx) => (
            <div key={idx} className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400 text-[11px]">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{err}</span>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-content-muted leading-normal">
        {t("wizardCopy.webhookHelper.description")}
      </p>
    </div>
  );
}
