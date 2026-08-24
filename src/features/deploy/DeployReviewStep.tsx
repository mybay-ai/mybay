import { Check, Layers, Globe, Shield, Terminal, Settings, ArrowRight, Server, Key, AlertTriangle, CheckCircle2, ExternalLink, PlayCircle, PlusCircle, LayoutDashboard, HelpCircle, ArrowUpRight, FileText, Zap, HardDrive, LockKeyhole } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Card } from "../../components/ui";
import { useNavigate } from "react-router-dom";
import { InstanceReadinessNotice } from "../../components/instance-runtime/InstanceReadinessNotice";
import type { AgentInstance } from "../../types";

interface DeployReviewStepProps {
  step: number;
  data: any;
  createdInstance: any;
  testResults: any;
  onSuccess: (targetRoute?: string) => void;
  submitError?: string | null;
  onRetry?: () => void;
  isTraefik?: boolean;
  onViewGuide?: (guideId: string) => void;
  activeWorkflowTemplate?: any;
  activeBlueprint?: any;
  permissionConfirmed?: boolean;
  onPermissionConfirmedChange?: (checked: boolean) => void;
}

type DeployRiskLevel = "low" | "medium" | "high";

function getDeployPermissionSummary(data: any) {
  const skills = Array.isArray(data?.skills) ? data.skills.map((skill: any) => String(skill)) : [];
  const normalizedSkills = skills.map((skill: string) => skill.toLowerCase());
  const channel = data?.channel || "web";
  const thirdPartyChannels = channel && channel !== "web" && channel !== "none" ? [channel] : [];
  const hasDockerAccess = normalizedSkills.some((skill: string) => skill.includes("docker"));
  const hasFileAccess = normalizedSkills.some((skill: string) => skill.includes("file") || skill.includes("document") || skill.includes("pdf") || skill.includes("workspace")) || Boolean(data?.limitsDisk);
  const hasExternalNetwork = Boolean(data?.provider || data?.model) || thirdPartyChannels.length > 0 || normalizedSkills.some((skill: string) => skill.includes("browser") || skill.includes("search") || skill.includes("http") || skill.includes("web"));
  const sensitiveFields = ["providerApiKey", "providerCredentialId", "webhookUrl", "webhookSecret", "telegramBotToken", "discordBotToken", "feishuAppSecret", "slackBotToken", "slackSigningSecret", "dingtalkAppSecret", "wechatMpAppSecret", "wechatMpToken", "wechatMpEncodingAesKey", "wecomToken", "wecomEncodingAesKey", "whatsappAccessToken"];
  const sensitiveAssets = sensitiveFields.filter(field => {
    const value = data?.[field];
    return value !== undefined && value !== null && String(value).trim() !== "";
  });
  const allowAll = data?.gatewayAllowAllUsers || data?.allowMode === "allow_all";
  const risk: DeployRiskLevel = hasDockerAccess || allowAll || thirdPartyChannels.length >= 2
    ? "high"
    : thirdPartyChannels.length > 0 || hasExternalNetwork || hasFileAccess || sensitiveAssets.length > 0
    ? "medium"
    : "low";
  return { skills, thirdPartyChannels, hasDockerAccess, hasFileAccess, hasExternalNetwork, sensitiveAssets, risk };
}

function deployRiskClass(level: DeployRiskLevel) {
  if (level === "high") return "border-rose-300 dark:border-rose-700/70 bg-rose-50 dark:bg-rose-950/35 text-rose-700 dark:text-rose-300";
  if (level === "medium") return "border-amber-300 dark:border-amber-700/70 bg-amber-50 dark:bg-amber-950/35 text-amber-700 dark:text-amber-300";
  return "border-emerald-300 dark:border-emerald-700/70 bg-emerald-50 dark:bg-emerald-950/35 text-emerald-700 dark:text-emerald-300";
}

function PermissionSummaryItem({ icon: Icon, label, active, detail }: { icon: any; label: string; active: boolean; detail: string }) {
  return (
    <div className="rounded-xl border border-outline bg-surface dark:bg-slate-900/80 p-3 flex items-start gap-2 min-w-0">
      <div className={active ? "mt-0.5 rounded-lg border border-indigo-100 bg-indigo-50 p-1.5 text-indigo-600 dark:border-indigo-800/70 dark:bg-indigo-950/45 dark:text-indigo-300" : "mt-0.5 rounded-lg border border-outline bg-surface-muted p-1.5 text-content-muted"}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[12px] font-bold text-content-secondary">{label}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-content-muted break-words">{detail}</p>
      </div>
    </div>
  );
}
interface ActionItem {
  label?: string;
  labelKey?: string;
  description?: string;
  descriptionKey?: string;
  iconName: "Layers" | "FileText" | "Key" | "LayoutDashboard" | "HelpCircle" | "Settings" | "Terminal" | "Globe" | "Bell" | "MessageSquare";
  route: string;
  isPrimary?: boolean;
  setupSection?: string;
}

const TEMPLATE_ACTION_METADATA: Record<string, {
  description?: string;
  descriptionKey?: string;
  iconName: "Layers" | "FileText" | "Key" | "LayoutDashboard" | "HelpCircle" | "Settings" | "Terminal";
  route: string;
  isPrimary?: boolean;
}> = {
  // competitor-price-monitor
  "input_urls": {
    descriptionKey: "wizardCopy.review.actionDescriptions.input_urls",
    iconName: "Settings",
    route: "/app/instances",
    isPrimary: true
  },
  "run_initial_scraping": {
    descriptionKey: "wizardCopy.review.actionDescriptions.run_initial_scraping",
    iconName: "Terminal",
    route: "/app/instances",
    isPrimary: false
  },
  // lead-form-auto-reply
  "update_knowledge_base": {
    descriptionKey: "wizardCopy.review.actionDescriptions.update_knowledge_base",
    iconName: "FileText",
    route: "/app/instances",
    isPrimary: true
  },
  "configure_webhook_url": {
    descriptionKey: "wizardCopy.review.actionDescriptions.configure_webhook_url",
    iconName: "Terminal",
    route: "/app/instances",
    isPrimary: false
  },
  // feishu-message-summary
  "configure_credentials": {
    descriptionKey: "wizardCopy.review.actionDescriptions.configure_credentials",
    iconName: "Key",
    route: "/app/instances",
    isPrimary: true
  },
  "run_test_job": {
    descriptionKey: "wizardCopy.review.actionDescriptions.run_test_job",
    iconName: "Terminal",
    route: "/app/instances",
    isPrimary: false
  },
  // xiaohongshu-topic-generator
  "configure_niche": {
    descriptionKey: "wizardCopy.review.actionDescriptions.configure_niche",
    iconName: "Settings",
    route: "/app/instances",
    isPrimary: true
  },
  "generate_topics": {
    descriptionKey: "wizardCopy.review.actionDescriptions.generate_topics",
    iconName: "Terminal",
    route: "/app/instances",
    isPrimary: false
  },
  // daily-news-briefing
  "trigger_manual_run": {
    descriptionKey: "wizardCopy.review.actionDescriptions.trigger_manual_run",
    iconName: "Terminal",
    route: "/app/instances",
    isPrimary: true
  },
  "set_cron_schedule": {
    descriptionKey: "wizardCopy.review.actionDescriptions.set_cron_schedule",
    iconName: "Settings",
    route: "/app/instances",
    isPrimary: false
  },
  // short-video-script-analyzer
  "upload_script": {
    descriptionKey: "wizardCopy.review.actionDescriptions.upload_script",
    iconName: "FileText",
    route: "/app/instances",
    isPrimary: true
  },
  "analyze_now": {
    descriptionKey: "wizardCopy.review.actionDescriptions.analyze_now",
    iconName: "Terminal",
    route: "/app/instances",
    isPrimary: false
  },
  // pdf-summary
  "upload_pdf": {
    descriptionKey: "wizardCopy.review.actionDescriptions.upload_pdf",
    iconName: "FileText",
    route: "/app/instances",
    isPrimary: true
  },
  "run_pdf_summary": {
    descriptionKey: "wizardCopy.review.actionDescriptions.run_pdf_summary",
    iconName: "Terminal",
    route: "/app/instances",
    isPrimary: false
  },
  // ecommerce-order-alert
  "configure_webhook": {
    descriptionKey: "wizardCopy.review.actionDescriptions.configure_webhook",
    iconName: "Terminal",
    route: "/app/instances",
    isPrimary: true
  },
  "test_payload": {
    descriptionKey: "wizardCopy.review.actionDescriptions.test_payload",
    iconName: "Settings",
    route: "/app/instances",
    isPrimary: false
  },
  // Blueprint enhancement actions
  "open_instance_settings": {
    descriptionKey: "wizardCopy.review.actionDescriptions.open_instance_settings",
    iconName: "Settings",
    route: "/app/instances",
    isPrimary: true
  },
  "upload_reference_files": {
    descriptionKey: "wizardCopy.review.actionDescriptions.upload_reference_files",
    iconName: "FileText",
    route: "/app/instances",
    isPrimary: false
  },
  "test_run": {
    descriptionKey: "wizardCopy.review.actionDescriptions.test_run",
    iconName: "Terminal",
    route: "/app/instances",
    isPrimary: false
  },
  "connect_channel": {
    descriptionKey: "wizardCopy.review.actionDescriptions.connect_channel",
    iconName: "Key",
    route: "/app/instances",
    isPrimary: true
  },
  "schedule_first_job": {
    descriptionKey: "wizardCopy.review.actionDescriptions.schedule_first_job",
    iconName: "Layers",
    route: "/app/instances",
    isPrimary: false
  }
};

const DEFAULT_ACTIONS: ActionItem[] = [
  {
    labelKey: "wizardCopy.review.defaultActions.instance.label",
    descriptionKey: "wizardCopy.review.defaultActions.instance.description",
    iconName: "Layers",
    route: "/app/instances",
    isPrimary: true
  },
  {
    labelKey: "wizardCopy.review.defaultActions.credentials.label",
    descriptionKey: "wizardCopy.review.defaultActions.credentials.description",
    iconName: "Key",
    route: "/app/credentials"
  },
  {
    labelKey: "wizardCopy.review.defaultActions.guide.label",
    descriptionKey: "wizardCopy.review.defaultActions.guide.description",
    iconName: "HelpCircle",
    route: "/app/guides"
  }
];
const safeParseArray = (val: any): string[] => {
  if (!val) return [];
  if (Array.isArray(val)) {
    return val.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.filter((item): item is string => typeof item === "string" && item.trim() !== "");
        }
      } catch (e) {
        // Ignore
      }
    }
    return [trimmed];
  }
  return [];
};

const safeParseObjectsArray = (val: any): any[] => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {
        // Ignore
      }
    }
  }
  return [];
};

const getIconComponent = (iconName: string) => {
  switch (iconName) {
    case "Layers": return <Layers className="w-5 h-5 text-indigo-500 shrink-0" />;
    case "FileText": return <FileText className="w-5 h-5 text-teal-500 shrink-0" />;
    case "Key": return <Key className="w-5 h-5 text-amber-500 shrink-0" />;
    case "LayoutDashboard": return <LayoutDashboard className="w-5 h-5 text-blue-500 shrink-0" />;
    case "HelpCircle": return <HelpCircle className="w-5 h-5 text-sky-500 shrink-0" />;
    case "Settings": return <Settings className="w-5 h-5 text-content-muted shrink-0" />;
    case "Terminal": return <Terminal className="w-5 h-5 text-purple-500 shrink-0" />;
    default: return <Layers className="w-5 h-5 text-indigo-500 shrink-0" />;
  }
};

export function DeployReviewStep({ step, data, createdInstance, testResults, onSuccess, submitError, onRetry, isTraefik, onViewGuide, activeWorkflowTemplate, activeBlueprint, permissionConfirmed = false, onPermissionConfirmedChange }: DeployReviewStepProps) {
  const navigate = useNavigate();
  const { t } = useTranslation("deploy");
  const isReview = step === 6;
  const localizedGuideSteps = t("wizardCopy.review.genericGuideSteps", { returnObjects: true });
  const defaultGuideSteps = Array.isArray(localizedGuideSteps) ? localizedGuideSteps.map(String) : [];

  // Prioritize activeBlueprint, activeWorkflowTemplate, and finally data.template_id/template_slug
  const isBlueprint = !!activeBlueprint;
  const isWorkflow = !activeBlueprint && (!!activeWorkflowTemplate || !!data?.template_id || !!data?.template_slug);
  const isTemplateDeploy = isBlueprint || isWorkflow;

  const matchedWorkflowId = activeWorkflowTemplate?.id || activeWorkflowTemplate?.slug || data?.template_id || data?.template_slug || null;

  // 1. Blueprint guidance (prioritize dynamic data-driven, fallback to static)
  const bpPostDeployGuide = activeBlueprint ? safeParseArray(activeBlueprint.post_deploy_guide) : [];
  const blueprintGuideSteps = isBlueprint
    ? (bpPostDeployGuide.length > 0
        ? bpPostDeployGuide
        : defaultGuideSteps)
    : null;

  const blueprintDisplayName = activeBlueprint?.name || t("wizardCopy.review.blueprintFallback");

  // 2. Workflow guidance (prioritize template data-driven, fallback to static)
  const wfPostDeployGuide = activeWorkflowTemplate ? safeParseArray(activeWorkflowTemplate.post_deploy_guide) : [];
  const wfSetupSteps = activeWorkflowTemplate ? safeParseArray(activeWorkflowTemplate.setup_steps) : [];
  const workflowGuideSteps = isWorkflow
    ? (wfPostDeployGuide.length > 0
        ? wfPostDeployGuide
        : wfSetupSteps.length > 0
        ? wfSetupSteps
        : defaultGuideSteps)
    : null;

  const workflowDisplayName = activeWorkflowTemplate?.name || t("wizardCopy.review.workflowFallback");

  // Actions (prioritize backend, fallback to static, only display if isTemplateDeploy)
  const bpNextActions = activeBlueprint ? safeParseObjectsArray(activeBlueprint.next_actions) : [];
  const wfNextActions = activeWorkflowTemplate ? safeParseObjectsArray(activeWorkflowTemplate.next_actions) : [];

  const currentActions = isBlueprint
    ? (bpNextActions.length > 0
        ? bpNextActions
        : DEFAULT_ACTIONS)
    : isWorkflow
    ? (wfNextActions.length > 0
        ? wfNextActions
        : DEFAULT_ACTIONS)
    : null;

  // Determine if allowlist is empty prior to deployment
  const isTelegramEmpty = data.channel === "telegram" && !(data.telegramAllowedUsers || "").trim() && !(data.telegramAllowedChats || "").trim();
  const isFeishuEmpty = data.channel === "feishu" && !(data.feishuAllowedUsers || "").trim() && !(data.feishuAllowedChats || "").trim();
  const isSlackEmpty = data.channel === "slack" && !(data.slackAllowedUsers || "").trim() && !(data.slackAllowedChannels || "").trim();
  const isDiscordEmpty = data.channel === "discord" && !(data.discordAllowedGuilds || "").trim() && !(data.discordAllowedUsers || "").trim() && !(data.discordAllowedChannels || "").trim();
  const isWebhookEmpty = data.channel === "webhook" && !(data.webhookAllowedUsers || "").trim() && !(data.webhookAllowedChannels || "").trim();

  const isAllowlistEmpty = data.channel && data.channel !== "none" && !data.gatewayAllowAllUsers && (isTelegramEmpty || isFeishuEmpty || isSlackEmpty || isDiscordEmpty || isWebhookEmpty);

  const getAllowlistCount = () => {
    if (data.channel === "none") return 0;

    let rawItems: string[] = [];

    if (data.channel === "telegram") {
      if (data.telegramAllowedUsers) rawItems = rawItems.concat(data.telegramAllowedUsers.split(","));
      if (data.telegramAllowedChats) rawItems = rawItems.concat(data.telegramAllowedChats.split(","));
    } else if (data.channel === "feishu") {
      if (data.feishuAllowedUsers) rawItems = rawItems.concat(data.feishuAllowedUsers.split(","));
      if (data.feishuAllowedChats) rawItems = rawItems.concat(data.feishuAllowedChats.split(","));
    } else if (data.channel === "slack") {
      if (data.slackAllowedUsers) rawItems = rawItems.concat(data.slackAllowedUsers.split(","));
      if (data.slackAllowedChannels) rawItems = rawItems.concat(data.slackAllowedChannels.split(","));
    } else if (data.channel === "webhook") {
      if (data.webhookAllowedUsers) rawItems = rawItems.concat(data.webhookAllowedUsers.split(","));
      if (data.webhookAllowedChannels) rawItems = rawItems.concat(data.webhookAllowedChannels.split(","));
    } else if (data.channel === "discord") {
      if (data.discordAllowedGuilds) rawItems = rawItems.concat(data.discordAllowedGuilds.split(","));
      if (data.discordAllowedUsers) rawItems = rawItems.concat(data.discordAllowedUsers.split(","));
      if (data.discordAllowedChannels) rawItems = rawItems.concat(data.discordAllowedChannels.split(","));
    }

    return rawItems.map(item => item.trim()).filter(item => item.length > 0).length;
  };

  const channelTargetCount = getAllowlistCount();
  const permissionSummary = getDeployPermissionSummary(data);
  const riskLabel = t(`trustPermission.risk.${permissionSummary.risk}`);

  const getPlatformConnectionText = () => {
    if (data.channel === "none") return t("wizardCopy.review.channelNone");
    if (testResults.channel?.result?.success) {
      return t("wizardCopy.review.channelConnected");
    }
    return t("wizardCopy.review.channelUntested");
  };

  if (isReview) {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
        {activeBlueprint && activeBlueprint.id && (
          <div className="p-4 bg-surface-muted border border-outline/80 text-content rounded-xl text-[13px] flex justify-between items-center animate-in fade-in">
            <span className="font-bold text-content-secondary flex items-center gap-1.5 font-sans">
              <span className="inline-block w-2-h-2 bg-blue-500 rounded-full animate-pulse" />
              {t("wizardCopy.review.templateReference")}
            </span>
            <span className="font-bold text-blue-600 font-sans">
              📋 {t("wizardCopy.review.templateName", { name: blueprintDisplayName })}
            </span>
          </div>
        )}

        {submitError && (
          <div className="space-y-1.5 rounded-xl border border-red-200 bg-red-50 p-4 text-[13px] text-red-900 animate-in shake duration-200 dark:border-red-900/70 dark:bg-red-950/35 dark:text-red-200">
            <p className="flex items-center gap-1.5 font-semibold text-red-800 dark:text-red-300">
              <span className="inline-block w-2 h-2 bg-red-500 rounded-full" />
              {t("wizardCopy.review.validationBlocked")}
            </p>
            <p className="opacity-90 leading-relaxed font-mono">
              {submitError}
            </p>
            <p className="font-sans text-[13px] text-red-700 dark:text-red-300">
              {submitError.includes("\u6280\u80fd")
                ? "\u8bf7\u68c0\u67e5\u5f53\u524d\u6a21\u677f\u7684 enabled_skills \u662f\u5426\u4e0e\u7cfb\u7edf\u6280\u80fd\u6ce8\u518c\u8868\u4e00\u81f4\uff0c\u8bf7\u8fd4\u56de\u7b2c\u516d\u6b65\u6280\u80fd\u786e\u8ba4\u540e\u91cd\u8bd5\u3002"
                : (submitError.includes("\u989d\u5ea6") || submitError.toLowerCase().includes("quota") || submitError.includes("PLAN_INSTANCE_LIMIT_REACHED"))
                ? "\u5f53\u524d\u5957\u9910\u5b9e\u4f8b\u989d\u5ea6\u5df2\u7528\u5b8c\u6216\u6743\u76ca\u5c1a\u672a\u540c\u6b65\u3002\u8bf7\u5237\u65b0\u9875\u9762\u91cd\u8bd5\uff0c\u6216\u8054\u7cfb\u7ba1\u7406\u5458\u68c0\u67e5\u8ba2\u9605\u5957\u9910\u548c\u5b9e\u4f8b\u989d\u5ea6\u3002"
                : (submitError.toLowerCase().includes("feishu") || submitError.includes("\u98de\u4e66"))
                ? "\\u98de\\u4e66 / Lark \\u6e20\\u9053\\u9700\\u8981\\u5f53\\u524d\\u5b98\\u65b9 Hermes \\u7248\\u672c\\u58f0\\u660e Feishu capability\\uff0c\\u8bf7\\u8fd4\\u56de\\u5bb9\\u5668\\u914d\\u7f6e\\u9009\\u62e9\\u517c\\u5bb9\\u7248\\u672c\\u540e\\u91cd\\u8bd5\\u3002"
                : "\u8bf7\u8fd4\u56de\u524d\u9762\u6b65\u9aa4\u68c0\u67e5\u914d\u7f6e\u540e\u91cd\u8bd5\u3002"}
            </p>
          </div>
        )}

        <div className="p-5 border border-indigo-200 dark:border-indigo-700/70 bg-indigo-50/40 dark:bg-indigo-950/30 rounded-2xl space-y-4">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
            <div>
              <p className="text-[12px] font-bold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">{t("trustPermission.eyebrow")}</p>
              <h3 className="mt-1 text-base font-bold text-content">{t("trustPermission.title")}</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-content-secondary max-w-2xl">{t("trustPermission.description")}</p>
            </div>
            <span className={"inline-flex shrink-0 items-center justify-center rounded-lg border px-3 py-1 text-[12px] font-bold " + deployRiskClass(permissionSummary.risk)}>
              {t("trustPermission.riskLabel")}: {riskLabel}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <PermissionSummaryItem icon={Settings} label={t("trustPermission.model")} active={Boolean(data.provider || data.model)} detail={`${data.provider || t("trustPermission.none")} / ${data.model || t("trustPermission.unspecified")}`} />
            <PermissionSummaryItem icon={Globe} label={t("trustPermission.channels")} active={permissionSummary.thirdPartyChannels.length > 0} detail={permissionSummary.thirdPartyChannels.length > 0 ? permissionSummary.thirdPartyChannels.join(", ") : t("trustPermission.webOnly")} />
            <PermissionSummaryItem icon={Zap} label={t("trustPermission.externalNetwork")} active={permissionSummary.hasExternalNetwork} detail={permissionSummary.hasExternalNetwork ? t("trustPermission.externalNetworkEnabled") : t("trustPermission.externalNetworkDisabled")} />
            <PermissionSummaryItem icon={HardDrive} label={t("trustPermission.fileAccess")} active={permissionSummary.hasFileAccess} detail={permissionSummary.hasFileAccess ? t("trustPermission.fileAccessEnabled") : t("trustPermission.fileAccessDisabled")} />
            <PermissionSummaryItem icon={Terminal} label={t("trustPermission.dockerAccess")} active={permissionSummary.hasDockerAccess} detail={permissionSummary.hasDockerAccess ? t("trustPermission.dockerAccessEnabled") : t("trustPermission.dockerAccessDisabled")} />
            <PermissionSummaryItem icon={LockKeyhole} label={t("trustPermission.sensitiveAssets")} active={permissionSummary.sensitiveAssets.length > 0} detail={t("trustPermission.sensitiveAssetsCount", { count: permissionSummary.sensitiveAssets.length })} />
          </div>

          <label className="flex items-start gap-3 rounded-xl border border-outline bg-surface px-4 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={permissionConfirmed}
              onChange={event => onPermissionConfirmedChange?.(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-outline-strong text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-[13px] font-semibold leading-relaxed text-content">{t("trustPermission.confirmLabel")}</span>
          </label>
        </div>

        {isAllowlistEmpty && (
          <div className="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-900 animate-in fade-in dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200">
            <p className="flex items-center gap-1.5 font-bold text-amber-800 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              <span>{t("wizardCopy.review.allowlistWarningTitle")}</span>
            </p>
            <p className="font-sans font-medium leading-relaxed text-amber-950 opacity-95 dark:text-amber-100">
              {t("wizardCopy.review.allowlistWarning")}
            </p>
            <p className="text-[11px] text-amber-700 dark:text-amber-300">
              {t("wizardCopy.review.allowlistWarningDetail")}
            </p>
          </div>
        )}

        <div className="p-6 border border-blue-200 dark:border-blue-800/70 bg-blue-50/20 dark:bg-blue-950/30 rounded-2xl text-center">
          <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-200 flex items-center justify-center mx-auto mb-3">
            <Check className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-content">{t("wizardCopy.review.readyTitle")}</h3>
          <p className="text-[13px] text-content-muted mt-2 max-w-md mx-auto leading-relaxed">
            {t("wizardCopy.review.readyDescription")}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[13px] font-mono">
          <div className="p-4 border border-outline bg-surface rounded-xl shadow-sm flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="p-1 px-1.5 rounded-lg bg-surface-muted text-content-secondary shrink-0">
                <Globe className="w-4 h-4" />
              </div>
              <span className="text-content-muted font-sans font-medium">{t("wizardCopy.review.route")}</span>
            </div>
            <span className="font-bold text-blue-600">/agent/{data.path}</span>
          </div>

          <div className="p-4 border border-outline bg-surface rounded-xl shadow-sm flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="p-1 px-1.5 rounded-lg bg-surface-muted text-content-secondary shrink-0">
                <Settings className="w-4 h-4" />
              </div>
              <span className="text-content-muted font-sans font-medium">{t("wizardCopy.review.model")}</span>
            </div>
            <span className="font-bold text-emerald-600 truncate max-w-[140px]">
              {data.provider} / {data.model}
            </span>
          </div>

          <div className="p-4 border border-outline bg-surface rounded-xl shadow-sm flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="p-1 px-1.5 rounded-lg bg-surface-muted text-content-secondary shrink-0">
                <Server className="w-4 h-4" />
              </div>
              <span className="text-content-muted font-sans font-medium">{t("wizardCopy.review.port")}</span>
            </div>
            <span className="font-bold text-content-secondary">
              {isTraefik ? t("wizardCopy.review.portTraefik") : (data.port ? `Host: ${data.port}` : t("wizardCopy.review.portAuto"))}
            </span>
          </div>

          <div className="p-4 border border-outline bg-surface rounded-xl shadow-sm flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="p-1 px-1.5 rounded-lg bg-surface-muted text-content-secondary shrink-0">
                <Terminal className="w-4 h-4" />
              </div>
              <span className="text-content-muted font-sans font-medium">{t("wizardCopy.review.channel")}</span>
            </div>
            <span className="font-bold text-purple-600">
              {data.channel === "none" ? t("wizardCopy.review.localOnly") : `${data.channel?.toUpperCase()} (${data.channelMode || 'testing'})`}
            </span>
          </div>
        </div>

        {/* Template & Skills configuration review */}
        <div className="p-4 border border-outline bg-surface-muted/40 rounded-2xl space-y-3 text-[13px]">
          <div className="flex items-center justify-between border-b pb-2">
            <span className="font-bold text-content">{t("wizardCopy.review.skills")}</span>
            <span className="text-content-muted">
              {data.skills && data.skills.length > 0 ? t("wizardCopy.review.skillsEnabled", { count: data.skills.length }) : t("wizardCopy.review.noSkills")}
            </span>
          </div>
          {data.skills && data.skills.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 animate-in fade-in">
              {data.skills.map((s: string) => (
                <span key={s} className="px-2 py-0.5 rounded bg-surface border border-outline text-content-secondary font-mono text-[10.5px] font-semibold shadow-sm">
                  ⚡ {s}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-content-muted font-sans italic">{t("wizardCopy.review.noSkillsDescription")}</p>
          )}

          {data.template_id && (
            <div className="pt-2 border-t border-outline/50 space-y-2 animate-in fade-in">
              <div className="flex items-center justify-between">
                <span className="font-bold text-content">🚀 {t("wizardCopy.review.matchedTemplate")}</span>
                <span className="rounded border border-indigo-100 bg-indigo-50/70 px-2 py-0.5 font-mono font-bold text-indigo-650 dark:border-indigo-800/70 dark:bg-indigo-950/40 dark:text-indigo-300">
                  {data.template_slug || data.template_id}
                </span>
              </div>
              <p className="text-[13px] text-content-muted font-medium font-sans leading-relaxed">
                {t("wizardCopy.review.templateInitialization")}
              </p>
            </div>
          )}
        </div>

        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="font-semibold flex items-center gap-2">
            <span className="inline-block w-2 h-2 bg-amber-500 rounded-full animate-ping" />
            {t("wizardCopy.review.startupNoticeTitle")}
          </p>
          <p className="opacity-90 leading-relaxed text-[13px]">
            {t("wizardCopy.review.startupNotice")}
          </p>
        </div>

        {data.channel && data.channel !== "none" && onViewGuide && (
          <div className="p-4 bg-blue-50/40 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/70 text-blue-900 dark:text-blue-200 rounded-xl text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-in fade-in duration-300">
            <div className="space-y-1">
              <p className="font-bold text-blue-950 dark:text-blue-200">{t("wizardCopy.review.channelGuideReady")}</p>
              <p className="opacity-95 leading-relaxed text-blue-700 dark:text-blue-300 text-[13px]">
                {t("wizardCopy.review.channelGuideDescription", { channel: data.channel?.toUpperCase() })}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onViewGuide(data.channel)}
              className="text-sm bg-surface text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950/60 border-blue-250 dark:border-blue-800/70 shrink-0 font-semibold h-10 px-4 whitespace-nowrap self-start sm:self-auto"
            >
              {t("wizardCopy.review.viewChannelGuide", { channel: data.channel?.toUpperCase() })}
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (step === 7 && createdInstance?.deploymentStatus !== "success") {
    const failed = ["failed", "cancelled"].includes(createdInstance?.deploymentStatus);
    const currentStep = createdInstance?.currentStep || "queued";
    const stepLabel = t("wizardCopy.review.deploymentProgress.steps." + currentStep, {
      defaultValue: t("wizardCopy.review.deploymentProgress.processing")
    });
    const errorCode = createdInstance?.errorCode;
    const failureMessage = errorCode
      ? t("wizardCopy.review.deploymentProgress.errors." + errorCode, {
          defaultValue: t("wizardCopy.review.deploymentProgress.genericFailure")
        })
      : t("wizardCopy.review.deploymentProgress.genericFailure");
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <div className={`rounded-2xl border p-6 ${failed ? "border-red-200 bg-red-50 dark:border-red-900/70 dark:bg-red-950/35" : "border-blue-200 bg-blue-50/40 dark:border-blue-800/70 dark:bg-blue-950/35"}`}>
          <h3 className="text-xl font-bold text-content">{failed ? t("wizardCopy.review.deploymentProgress.failedTitle") : t("wizardCopy.review.deploymentProgress.title")}</h3>
          <p className="mt-2 text-sm text-content-secondary">{failed ? failureMessage : stepLabel}</p>
          {!failed && <div className="mt-5 h-2 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-950/80"><div className="h-full bg-blue-600 transition-all dark:bg-blue-400" style={{ width: `${Math.max(5, Number(createdInstance?.progress || 5))}%` }} /></div>}
          <div className="mt-3 text-xs font-mono text-content-muted">{failed && errorCode ? errorCode : t("wizardCopy.review.deploymentProgress.currentStage", { stage: stepLabel })}</div>
          {failed && onRetry && <Button type="button" onClick={onRetry} className="mt-5">{t("wizardCopy.review.deploymentProgress.retry")}</Button>}
        </div>
      </div>
    );
  }
  // Else, step === 7 Success page
  const deployedInstance = {
    ...createdInstance,
    status: createdInstance?.instanceStatus || createdInstance?.status || "running",
  } as AgentInstance;
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300 font-sans">
      <div className="rounded-2xl border border-green-200 bg-green-50/20 p-6 text-center dark:border-emerald-800/70 dark:bg-emerald-950/30">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-emerald-950/70 dark:text-emerald-300">
          <Layers className="w-7 h-7" />
        </div>
        <h3 className="text-xl font-bold text-content">{t("wizardCopy.review.deployedTitle")}</h3>
        <p className="text-[13px] md:text-sm text-content-muted mt-2.5 max-w-lg mx-auto leading-relaxed">
          {t("wizardCopy.review.deployedDescription", { name: createdInstance?.name })}
        </p>
      </div>

      {createdInstance?.id && <InstanceReadinessNotice instance={deployedInstance} />}

      <div className="border border-outline rounded-2xl bg-surface overflow-hidden p-6 shadow-sm space-y-4">
        <div className="border-b pb-3 flex items-center gap-2 text-content">
          <Shield className="w-5 h-5 text-green-600" />
          <h4 className="font-bold text-sm">{t("wizardCopy.review.checklistTitle", { name: createdInstance?.name || "MyBay" })}</h4>
        </div>

        <div className="space-y-4 text-[13px] sm:text-sm leading-normal">
          <div className="flex justify-between border-b border-outline pb-2">
            <span className="text-content-muted">{t("template_selection.dashboard_check_label")}</span>
            {data.enableDashboard === false ? (
              <span className="font-mono text-content-muted font-bold bg-surface-muted px-2 py-0.5 rounded">
                {t("template_selection.dashboard_check_disabled")}
              </span>
            ) : (
              <span className="rounded bg-green-50 px-2 py-0.5 font-mono font-bold text-green-600 dark:bg-emerald-950/40 dark:text-emerald-300">
                {t("template_selection.dashboard_check_enabled", { username: data.username || "admin" })}
              </span>
            )}
          </div>

          <div className="flex justify-between border-b border-outline pb-2">
            <span className="text-content-muted">{t("wizardCopy.review.gatewayRoute")}</span>
            <span className="rounded bg-blue-50 px-1.5 py-0.5 font-mono font-bold text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">
              {t("wizardCopy.review.routing")}
            </span>
          </div>

          <div className="flex justify-between border-b border-outline pb-2">
            <span className="text-content-muted">{t("wizardCopy.review.channelMode")}</span>
            <span className={`font-mono font-bold px-1.5 py-0.5 rounded uppercase ${
              data.channelMode === "production" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
            }`}>
              {data.channelMode || "testing"} Mode
            </span>
          </div>

          <div className="flex justify-between border-b border-outline pb-2">
            <span className="text-content-muted">{t("wizardCopy.review.channelStatus")}</span>
            <span className={`font-mono font-bold px-1.5 py-0.5 rounded ${
              data.channel === "none"
                ? "text-content-muted bg-surface-muted"
                : testResults.channel?.result?.success
                ? "bg-green-50 text-green-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                : "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
            }`}>
              {getPlatformConnectionText()}
            </span>
          </div>

          <div className="flex justify-between border-b border-outline pb-2">
            <span className="text-content-muted">{t("wizardCopy.review.allowlistTargets")}</span>
            <span className={`font-mono font-bold px-1.5 py-0.5 rounded ${
              data.channel === "none"
                ? "text-content-muted bg-surface-muted"
                : data.gatewayAllowAllUsers
                ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                : channelTargetCount > 0
                ? "bg-green-50 text-green-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
            }`}>
              {data.channel === "none"
                ? "N/A"
                : data.gatewayAllowAllUsers
                ? "Infinity 🔥 (Allow All)"
                : t("wizardCopy.review.targetCount", { count: channelTargetCount })}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center pt-1.5 gap-2">
            <span className="text-content-muted">{t("wizardCopy.review.accessUrl")}</span>
            <a
              href={createdInstance?.url || `/agent/${createdInstance?.path || data.path}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded border border-blue-100 bg-blue-50/50 px-2 py-1 font-mono text-sm font-bold text-blue-600 hover:bg-blue-50 hover:underline dark:border-blue-800/70 dark:bg-blue-950/35 dark:text-blue-300 dark:hover:bg-blue-900/50"
            >
              <span>{createdInstance?.url || `/agent/${data.path}`}</span>
              <Globe className="w-3.5 h-3.5"/>
            </a>
          </div>
        </div>
      </div>

      {data.channel && data.channel !== "none" && onViewGuide && (
        <div className="flex flex-col justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50/40 p-4 text-[13px] text-teal-900 animate-in fade-in duration-300 dark:border-teal-800/70 dark:bg-teal-950/30 dark:text-teal-200 sm:flex-row sm:items-center">
          <div className="space-y-0.5">
            <p className="font-bold text-teal-950 dark:text-teal-200">{t("wizardCopy.review.chatGuideTitle")}</p>
            <p className="leading-relaxed text-content-secondary opacity-95">
              {t("wizardCopy.review.chatGuideDescription", { channel: data.channel?.toUpperCase() })}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onViewGuide(data.channel)}
            className="bg-surface text-[13px] text-teal-700 hover:bg-teal-100 border-teal-250 dark:border-teal-800/70 dark:bg-teal-950/30 dark:text-teal-300 dark:hover:bg-teal-900/40 shrink-0 font-semibold h-8.5 px-3 whitespace-nowrap self-start sm:self-auto"
          >
            {t("wizardCopy.review.viewChannelGuide", { channel: data.channel?.toUpperCase() })}
          </Button>
        </div>
      )}

      {/* Red Alert Card if Allowlist Target count is 0 and Allow All is disabled */}
      {data.channel !== "none" && channelTargetCount === 0 && !data.gatewayAllowAllUsers && (
        <div className="space-y-1 rounded-xl border border-red-200 bg-red-50 p-4 text-[13px] text-red-950 animate-in shake duration-200 dark:border-red-900/70 dark:bg-red-950/35 dark:text-red-200">
          <p className="flex items-center gap-1.5 font-bold text-red-800 dark:text-red-300">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{t("wizardCopy.review.zeroTargetsTitle")}</span>
          </p>
          <p className="opacity-95 leading-relaxed text-[13px]">
            {t("wizardCopy.review.zeroTargetsDescription")}
          </p>
        </div>
      )}

      {/* Next Step Guidance for Industry Templates */}
      {blueprintGuideSteps && (
        <div className="bg-gradient-to-br from-slate-900 to-slate-950 text-white rounded-2xl p-6 shadow-md border border-slate-800 space-y-4 text-left animate-in fade-in duration-300">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <h4 className="font-bold text-sm text-slate-100">🎯 {t("wizardCopy.review.nextGuideTitle", { name: blueprintDisplayName })}</h4>
          </div>
          <p className="text-[13px] text-content-muted leading-relaxed">
            {t("wizardCopy.review.blueprintGuideDescription")}
          </p>
          <ol className="space-y-3 pl-4 list-decimal text-[13px] text-slate-350">
            {blueprintGuideSteps.map((guideStep: string, idx: number) => (
              <li key={idx} className="leading-relaxed">
                <span className="font-medium text-slate-100">{guideStep}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Next Step Guidance for Workflow Templates */}
      {!blueprintGuideSteps && workflowGuideSteps && (
        <div className="bg-gradient-to-br from-indigo-900 to-indigo-950 text-white rounded-2xl p-6 shadow-md border border-indigo-800 space-y-4 text-left animate-in fade-in duration-300">
          <div className="flex items-center gap-2 border-b border-indigo-800 pb-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <h4 className="font-bold text-sm text-slate-100">🎯 {t("wizardCopy.review.nextGuideTitle", { name: workflowDisplayName })}</h4>
          </div>
          <p className="text-[13px] text-indigo-200 leading-relaxed">
            {t("wizardCopy.review.workflowGuideDescription")}
          </p>
          <ol className="space-y-3 pl-4 list-decimal text-[13px] text-indigo-150">
            {workflowGuideSteps.map((guideStep: string, idx: number) => (
              <li key={idx} className="leading-relaxed">
                <span className="font-medium text-slate-100">{guideStep}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Immediate Test Run Guide Section */}
      {isTemplateDeploy && (
        <div className="space-y-3 rounded-2xl border border-indigo-200 bg-indigo-50/45 p-5 text-left animate-in fade-in duration-300 dark:border-indigo-800/70 dark:bg-indigo-950/30">
          <div className="flex items-center gap-2 text-indigo-950 dark:text-indigo-200">
            <Zap className="w-5 h-5 text-indigo-600 animate-pulse shrink-0" />
            <h4 className="text-sm font-extrabold text-indigo-950 dark:text-indigo-200">{t("wizardCopy.review.quickTestTitle")}</h4>
          </div>
          <p className="text-[13px] font-medium leading-relaxed text-content-secondary">
            {t("wizardCopy.review.quickTestDescription")}
          </p>
          <div className="space-y-3 rounded-xl border border-indigo-150/50 bg-surface/85 p-4 shadow-sm dark:border-indigo-800/50 dark:bg-slate-900/65">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[13px] font-extrabold text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300">
                1
              </span>
              <div className="space-y-0.5">
                <span className="text-[13px] font-black text-content block">{t("wizardCopy.review.quickStep1Title")}</span>
                <span className="text-content-muted text-[13px] leading-relaxed block font-medium">
                  {t("wizardCopy.review.quickStep1Description")}
                </span>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[13px] font-extrabold text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300">
                2
              </span>
              <div className="space-y-0.5">
                <span className="text-[13px] font-black text-content block">{t("wizardCopy.review.quickStep2Title")}</span>
                <span className="text-content-muted text-[13px] leading-relaxed block font-medium">
                  {t("wizardCopy.review.quickStep2Description")}
                </span>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[13px] font-extrabold text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300">
                3
              </span>
              <div className="space-y-0.5">
                <span className="text-[13px] font-black text-content block">{t("wizardCopy.review.quickStep3Title")}</span>
                <span className="text-content-muted text-[13px] leading-relaxed block font-medium">
                  {t("wizardCopy.review.quickStep3Description")}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Actionable Next Steps Section for Templates / Blueprints */}
      {isTemplateDeploy && currentActions && currentActions.length > 0 && (() => {
        const normalizedActions = currentActions.map((item: any) => {
          let act: any = {};
          if (typeof item === "string") {
            act = { action: item };
          } else if (item && typeof item === "object") {
            act = { ...item };
          }

          if (act.route) {
            let route = act.route;
            if (createdInstance?.id) {
              if (act.setupSection) {
                route = `/app/instances/${createdInstance.id}/setup?section=${act.setupSection}`;
              } else {
                if (route.includes(":id")) {
                  route = route.replace(":id", createdInstance.id);
                } else {
                  route = route.includes("?") ? `${route}&id=${createdInstance.id}` : `${route}?id=${createdInstance.id}`;
                }
              }
            }
            return {
              ...act,
              label: act.label || (act.labelKey ? t(act.labelKey) : t("wizardCopy.review.completeConfiguration")),
              description: act.description || (act.descriptionKey ? t(act.descriptionKey) : t("wizardCopy.review.completeConfigurationDescription")),
              route
            } as ActionItem;
          }

          const actionKey = act.action;
          const meta = actionKey ? TEMPLATE_ACTION_METADATA[actionKey] : null;

          if (meta) {
            // Append instance ID or folder name if applicable to make it a deep-link
            let finalRoute = meta.route;
            if (createdInstance?.id) {
              if (actionKey === "upload_pdf" || actionKey === "upload_script" || actionKey === "upload_reference_files") {
                finalRoute = `${meta.route}?id=${createdInstance.id}&tab=files`;
              } else if (actionKey === "run_initial_scraping" || actionKey === "run_test_job" || actionKey === "generate_topics" || actionKey === "trigger_manual_run" || actionKey === "analyze_now" || actionKey === "test_payload" || actionKey === "test_run") {
                finalRoute = `${meta.route}?id=${createdInstance.id}&tab=logs`;
              } else {
                finalRoute = `${meta.route}?id=${createdInstance.id}`;
              }
            }

            const defaultLabels: Record<string, string> = {
              "input_urls": t("wizardCopy.review.actions.importCompetitors"),
              "run_initial_scraping": t("wizardCopy.review.actions.runPriceScraping"),
              "update_knowledge_base": t("wizardCopy.review.actions.uploadProductGuide"),
              "configure_webhook_url": t("wizardCopy.review.actions.configureWebhookUrl"),
              "configure_credentials": t("wizardCopy.review.actions.configureFeishuCredentials"),
              "run_test_job": t("wizardCopy.review.actions.runChatSummary"),
              "configure_niche": t("wizardCopy.review.actions.configureNiche"),
              "generate_topics": t("wizardCopy.review.actions.generateTopics"),
              "trigger_manual_run": t("wizardCopy.review.actions.runBriefing"),
              "set_cron_schedule": t("wizardCopy.review.actions.scheduleBriefing"),
              "upload_script": t("wizardCopy.review.actions.uploadScript"),
              "analyze_now": t("wizardCopy.review.actions.analyzeScript"),
              "upload_pdf": t("wizardCopy.review.actions.uploadPdf"),
              "run_pdf_summary": t("wizardCopy.review.actions.runPdfSummary"),
              "configure_webhook": t("wizardCopy.review.actions.configureWebhook"),
              "test_payload": t("wizardCopy.review.actions.testPayload"),
              "open_instance_settings": t("wizardCopy.review.actions.instanceSettings"),
              "upload_reference_files": t("wizardCopy.review.actions.uploadReferences"),
              "test_run": t("wizardCopy.review.actions.testRun"),
              "connect_channel": t("wizardCopy.review.actions.connectChannel"),
              "schedule_first_job": t("wizardCopy.review.actions.scheduleJob")
            };

            const finalLabel = act.label || defaultLabels[actionKey] || t("wizardCopy.review.unnamedAction");

            return {
              label: finalLabel,
              description: act.description || t(meta.descriptionKey),
              iconName: act.iconName || meta.iconName,
              route: finalRoute,
              isPrimary: act.isPrimary !== undefined ? act.isPrimary : meta.isPrimary
            } as ActionItem;
          }

          return {
            label: act.label || t("wizardCopy.review.completeConfiguration"),
            description: act.description || t("wizardCopy.review.completeConfigurationDescription"),
            iconName: act.iconName || ("Settings" as const),
            route: act.route || (createdInstance?.id ? `/app/instances?id=${createdInstance.id}` : "/app/instances"),
            isPrimary: act.isPrimary !== undefined ? act.isPrimary : false
          } as ActionItem;
        });

        return (
          <div className="space-y-4 animate-in fade-in duration-400 text-left pt-2 pb-2">
            <div className="flex items-center gap-2 border-b border-outline pb-2.5">
              <h4 className="font-extrabold text-sm text-content flex items-center gap-1.5">
                <span>{t("wizardCopy.review.recommendedActions")}</span>
              </h4>
            </div>
            <p className="text-[13px] text-content-muted leading-relaxed font-semibold">
              {t("wizardCopy.review.recommendedActionsDescription")}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {normalizedActions.map((action: ActionItem, idx: number) => {
                const isPrimary = action.isPrimary;
                return (
                  <div
                    key={idx}
                    onClick={() => {
                      // Trigger single-hop onSuccess transition to targeted page
                      if (action.route && createdInstance?.id) {
                        onSuccess(action.route.replace(":id", createdInstance.id));
                      } else {
                        onSuccess(action.route);
                      }
                    }}
                    className={`group relative flex flex-col justify-between p-4 rounded-2xl border transition-all duration-200 cursor-pointer text-left active:scale-[0.98] ${
                      isPrimary
                        ? "bg-gradient-to-br from-indigo-50/30 to-white border-indigo-200 hover:border-indigo-400 hover:shadow-md hover:shadow-indigo-50"
                        : "bg-surface border-outline hover:border-indigo-200 hover:shadow-md hover:shadow-indigo-50"
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between">
                        <div className={`p-2 rounded-xl ${
                          isPrimary ? "bg-indigo-100/75 text-indigo-700" : "bg-surface-muted text-content-secondary"
                        }`}>
                          {getIconComponent(action.iconName)}
                        </div>
                        {isPrimary && (
                          <span className="px-2 py-0.5 rounded-md text-[9px] font-black bg-indigo-600 text-white uppercase tracking-wider">
                            {t("wizardCopy.review.recommended")}
                          </span>
                        )}
                      </div>
                      <div className="space-y-1">
                        <h5 className="font-extrabold text-[13px] text-content group-hover:text-indigo-600 transition-colors">
                          {action.label}
                        </h5>
                        <p className="text-[13px] text-content-muted leading-relaxed font-medium">
                          {action.description}
                        </p>
                      </div>
                    </div>
                    <div className="flex justify-end pt-3 text-[13px] font-black text-slate-450 group-hover:text-indigo-600 transition-colors gap-1 items-center">
                      <span>{t("wizardCopy.review.goNow")}</span>
                      <ArrowUpRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      <div className="flex justify-center pt-2">
        <Button
          type="button"
          onClick={() => onSuccess()}
          className="bg-indigo-600 text-white hover:bg-indigo-700 rounded-xl h-11 px-8 font-semibold text-sm shadow-md shadow-indigo-950/25 transition flex items-center gap-2 cursor-pointer"
        >
          <span>{t("wizardCopy.review.finish")}</span>
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
