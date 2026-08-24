import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, HardDrive, ShieldAlert, Zap, Globe, Cpu, RefreshCw, Layers, Bell, Eye, EyeOff, Shield, Server, Activity, Compass, XCircle, Terminal, Users, TrendingUp, CheckCircle2, AlertCircle, Sparkles } from "lucide-react";
import { Socket } from "socket.io-client";
import { Button, Input, Label, Card } from "../../components/ui";
import type { SetupFormData } from "../../types";
import { useInstanceQuota } from "../../hooks/useInstanceQuota";
import { api } from "../../lib/api";
import { sanitizeDeployPayload } from "./sanitizeDeployPayload";
import { buildLocalDeploymentRequest } from "./localDeploymentRequestAdapter";
import { isDeploymentSuccessful, isDeploymentTerminal } from "./deploymentUiState";

// Import modular sub-components
import { WizardStepper, StepStatus } from "./WizardStepper";
import { WizardFooter } from "./WizardFooter";
import { PreflightStep } from "./PreflightStep";
import { InstanceInfoStep } from "./InstanceInfoStep";
import { ContainerConfigStep } from "./ContainerConfigStep";
import { ModelStep } from "./ModelStep";
import { ChannelStep } from "./ChannelStep";
import { isExternalDeployChannel } from "./ChannelSelector";
import { SkillsStep } from "./SkillsStep";
import { DeployReviewStep } from "./DeployReviewStep";
import { isDeployChannelAllowedByEntitlement } from "../../../shared/planChannelAccess";

export function DeployWizard({ 
  onSuccess, 
  socket, 
  currentUser, 
  onViewGuide, 
  instances = [],
  templateWorkflowsEnabled = false,
  templateType,
  advancedResourceConfigEnabled = false,
  templateId,
  blueprintId,
  onClearTemplateParams,
  onUpdateTemplateParams,
  onBackToSelection
}: { 
  onSuccess: (targetRoute?: string) => void, 
  socket: Socket | null, 
  currentUser: any, 
  onViewGuide?: (guideId: string) => void, 
  instances?: any[],
  templateWorkflowsEnabled?: boolean,
  advancedResourceConfigEnabled?: boolean,
  templateType?: string,
  templateId?: string,
  blueprintId?: string,
  onClearTemplateParams?: () => void,
  onUpdateTemplateParams?: (params: { template_type?: string; template_id?: string; blueprint_id?: string }) => void,
  onBackToSelection?: () => void
}) {
  const { t, i18n } = useTranslation("deploy");
  const quota = useInstanceQuota(currentUser, instances);
  const externalChannelsAllowed = quota.entitlementsReady ? quota.externalChannelsAllowed : true;
  const quotaUsed = Number(quota.activeInstances || 0);
  const quotaLimit = quota.maxActiveInstances === null ? null : Number(quota.maxActiveInstances || 0);
  const quotaRemaining = quotaLimit === null ? null : Math.max(0, quotaLimit - quotaUsed);
  const quotaStatusText = quotaLimit === null
    ? t("quota_check.quota_unlimited", { used: quotaUsed })
    : quota.canCreateInstance
      ? t("quota_check.quota_remaining", { used: quotaUsed, limit: quotaLimit, remaining: quotaRemaining })
      : t("quota_check.quota_full", { used: quotaUsed, limit: quotaLimit });
  const [showContactInfo, setShowContactInfo] = useState(false);

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [preflight, setPreflight] = useState<any>(null);
  const [testResults, setTestResults] = useState<any>({});
  const [createdInstance, setCreatedInstance] = useState<any>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [versions, setVersions] = useState<any[]>([]);
  const [showPassword, setShowPassword] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [trustPermissionConfirmed, setTrustPermissionConfirmed] = useState(false);
  const [activeWorkflowTemplate, setActiveWorkflowTemplate] = useState<any>(null);
  const [activeBlueprint, setActiveBlueprint] = useState<any>(null);

  const isTraefik = preflight?.proxyMode === "traefik";

  const isChannelAllowedByPlan = (channel: any) => isDeployChannelAllowedByEntitlement(channel, externalChannelsAllowed);
  const planChannelRestrictionMessage = t("validation.plan_channel_restricted");

  const [data, setData] = useState<Partial<SetupFormData>>({
    id: Math.random().toString(36).substring(7),
    runtime_type: "hermes",
    path: `agent-${Math.random().toString(36).substring(2, 8)}`,
    image: "nousresearch/hermes-agent",
    imageTag: "latest", // Split image and tag
    channel: "web",
    allowMode: "bind_later",
    modelBillingMode: "byok",
    enableDashboard: true,
    limitsCpu: "1",
    limitsMem: "1024MB"
  });

  const trustPermissionFingerprint = JSON.stringify({
    provider: data.provider,
    model: data.model,
    channel: data.channel,
    channelMode: data.channelMode,
    allowMode: data.allowMode,
    gatewayAllowAllUsers: data.gatewayAllowAllUsers,
    limitsDisk: (data as any).limitsDisk,
    providerCredentialId: data.providerCredentialId,
    providerApiKey: data.providerApiKey ? "configured" : "",
    skills: data.skills || []
  });

  useEffect(() => {
    setTrustPermissionConfirmed(false);
  }, [trustPermissionFingerprint]);

  useEffect(() => {
    const taskId = createdInstance?.deploymentTaskId;
    if (!taskId || isDeploymentTerminal(createdInstance?.deploymentStatus)) return;
    let stopped = false;
    const poll = async () => {
      try {
        const deployment = await api.get(`/api/deployments/${taskId}`);
        if (stopped) return;
        const terminalSuccess = isDeploymentSuccessful(deployment);
        setCreatedInstance((current: any) => current?.deploymentTaskId === taskId ? {
          ...current,
          deploymentStatus: terminalSuccess ? "success" : deployment.status,
          currentStep: deployment.currentStep,
          progress: deployment.progress,
          errorCode: deployment.errorCode,
          errorMessage: deployment.errorMessage,
          healthStatus: deployment.healthStatus,
          instanceStatus: deployment.instanceStatus,
        } : current);
      } catch (error) {
        console.error("Deployment status polling failed:", error);
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [createdInstance?.deploymentTaskId, createdInstance?.deploymentStatus]);

  useEffect(() => {
    runPreflight();
    fetchVersions();
  }, []);

  useEffect(() => {
    if (!templateWorkflowsEnabled) {
      setActiveWorkflowTemplate(null);
      setActiveBlueprint(null);
      setData(current => {
        const { template_id, template_slug, template_inputs, template_consent_ok, blueprint_id, blueprint_slug, blueprint_snapshot, ...plain } = current as any;
        return plain;
      });
      return;
    }


    if (templateType === "workflow" && templateId) {
      const loadWorkflowTemplate = async () => {
        try {
          const t = await api.get(`/api/templates/${templateId}?lang=${encodeURIComponent(i18n.resolvedLanguage || i18n.language || "zh-CN")}`);
          if (t) {
            setActiveWorkflowTemplate(t);
            setActiveBlueprint(null);
            // Run pre-fill preset logic
            const hasPermissions = t.required_permissions && t.required_permissions.length > 0;
            const presetConfig = {
              template_id: t.id,
              template_slug: t.slug || t.id,
              name: `${t.name}-${Math.random().toString(36).substring(7).toUpperCase()}`,
              username: "admin",
              prompt: t.default_prompt || "",
              provider: t.default_provider || "",
              model: t.default_model || "",
              channel: t.default_channel || "web",
              skills: t.default_skills || [],
              template_inputs: {} as any,
              template_consent_ok: !hasPermissions
            };
            
            if (t.required_inputs) {
              const defaults: any = {};
              for (const input of t.required_inputs) {
                const fieldKey = input.key || input.name || input.id;
                if (!fieldKey) continue;
                if (input.type === "select") {
                  defaults[fieldKey] = input.defaultValue ?? input.default_value ?? input.options?.[0]?.value ?? "";
                } else if (input.type === "boolean") {
                  defaults[fieldKey] = typeof input.defaultValue === "boolean" ? input.defaultValue : (input.default_value === true);
                } else {
                  defaults[fieldKey] = input.defaultValue ?? input.default_value ?? "";
                }
              }
              presetConfig.template_inputs = defaults;
            }
            
            setData(d => ({
              ...d,
              ...presetConfig,
              password: d.password || ""
            }));
          }
        } catch (e) {
          console.error("Failed to prefill workflow template:", e);
        }
      };
      
      loadWorkflowTemplate();
    } else if (templateType === "blueprint" && blueprintId) {
      const loadBlueprintTemplate = async () => {
        try {
          const blueprints = await api.get(`/api/templates/blueprints?lang=${encodeURIComponent(i18n.resolvedLanguage || i18n.language || "zh-CN")}`);
          const bp = blueprints.find((b: any) => b.id === blueprintId);
          if (bp) {
            setActiveBlueprint(bp);
            setActiveWorkflowTemplate(null);
            const presetConfig = {
              name: `${bp.name}-${Math.random().toString(36).substring(7).toUpperCase()}`,
              username: "admin",
              prompt: bp.system_context_preview || "",
              provider: "google",
              model: "gemini-1.5-flash",
              channel: bp.recommended_channels?.[0] || "web",
              skills: bp.recommended_skills || [],
              template_id: undefined,
              template_slug: undefined,
              blueprint_id: bp.id,
              blueprint_slug: bp.slug || bp.id,
              template_inputs: {},
              template_consent_ok: true
            };
            
            setData(d => ({
              ...d,
              ...presetConfig,
              password: d.password || ""
            }));
          }
        } catch (e) {
          console.error("Failed to prefill blueprint template:", e);
        }
      };
      
      loadBlueprintTemplate();
    } else {
      setActiveWorkflowTemplate(null);
      setActiveBlueprint(null);
      setData(d => {
        if (d.template_id !== undefined || d.template_slug !== undefined || d.template_inputs) {
          const { template_id, template_slug, template_inputs, template_consent_ok, ...rest } = d;
          return rest as any;
        }
        return d;
      });
    }
  }, [templateWorkflowsEnabled, templateType, templateId, blueprintId, currentUser, i18n.resolvedLanguage, i18n.language]);

  const fetchVersions = async () => {
    try {
      const data = await api.get("/api/agent-versions");
      if (data) {
        setVersions(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const runPreflight = async () => {
    if (currentUser?.role !== 'admin') {
      // Regular users don't see technical preflight details, mock success to allow deployment wizard flow
      setPreflight({
        status: "ok",
        checks: [
          { name: t("wizardCopy.preflight.localRuntime"), status: "ok", message: t("wizardCopy.preflight.localRuntimeReady") },
          { name: "Deployment quota check", status: "ok", message: "Local administrator can deploy instances." }
        ]
      });
      return;
    }
    setPreflight(null);
    try {
      const result = await api.get("/api/system/preflight");
      setPreflight(result);
    } catch (e: any) {
      console.error(e);
      if (e.status === 403) {
        setPreflight({
          status: "error",
          checks: [{ name: t("preflight_errors.permission_title"), status: "fail", message: t("preflight_errors.permission_msg") }]
        });
      } else {
        setPreflight({
          status: "error",
          checks: [{ name: t("preflight_errors.system_title"), status: "fail", message: t("preflight_errors.system_msg") }]
        });
      }
    }
  };


  const testLLM = async () => {
    setTestResults((tr: any) => ({ ...tr, llm: { loading: true } }));
    try {
      const result = await api.post("/api/system/test-llm", {
        provider: data.provider,
        model: data.model,
        baseUrl: data.baseUrl,
        apiKey: data.providerApiKey,
        credentialId: data.providerCredentialId
      });
      setTestResults((tr: any) => ({ ...tr, llm: { loading: false, result } }));
    } catch (e: any) {
      setTestResults((tr: any) => ({ ...tr, llm: { loading: false, result: { success: false, error: e.message } } }));
    }
  };

  const testChannel = async () => {
    setTestResults((tr: any) => ({ ...tr, channel: { loading: true } }));
    try {
      const sanitized = sanitizeDeployPayload(data);
      const result = await api.post("/api/system/test-channel", sanitized);
      setTestResults((tr: any) => ({ ...tr, channel: { loading: false, result } }));
    } catch (e: any) {
      setTestResults((tr: any) => ({ ...tr, channel: { loading: false, result: { success: false, error: e.message } } }));
    }
  };

  const testSkill = async (skillId: string) => {
    setTestResults((tr: any) => ({ ...tr, [`skill_${skillId}`]: { loading: true } }));
    try {
      const result = await api.post("/api/system/test-skill", { skillId, ...data });
      setTestResults((tr: any) => ({ ...tr, [`skill_${skillId}`]: { loading: false, result } }));
    } catch (e: any) {
      setTestResults((tr: any) => ({ ...tr, [`skill_${skillId}`]: { loading: false, result: { success: false, error: e.message } } }));
    }
  };

  const handleClearTemplate = () => {
    setActiveWorkflowTemplate(null);
    setActiveBlueprint(null);
    setData(d => {
      const { template_id, template_slug, template_inputs, template_consent_ok, ...rest } = d;
      return rest as any;
    });
    setTestResults({});
    if (onClearTemplateParams) {
      onClearTemplateParams();
    }
  };

  const handleChannelChange = (id: string) => {
    if (!isChannelAllowedByPlan(id)) {
      setTestResults((tr: any) => ({
        ...tr,
        channel: {
          loading: false,
          result: { success: false, error: planChannelRestrictionMessage }
        }
      }));
      return;
    }
    setTestResults((tr: any) => ({ ...tr, channel: undefined }));
    setData(d => {
      const updated = { ...d, channel: id };

      // 1. Clean up fields of other channels
      const channelFieldGroups: Record<string, string[]> = {
        telegram: ["telegramBotToken", "telegramAllowedUsers", "telegramAllowedChats"],
        feishu: ["feishuAppId", "feishuAppSecret", "feishuRegion", "feishuAllowedUsers", "feishuAllowedChats"],
        weixin: ["weixinAccountId", "weixinToken", "weixinBaseUrl", "weixinAllowedUsers", "weixinAllowedChats"],
        slack: ["slackBotToken", "slackSigningSecret", "slackAppToken", "slackAllowedUsers", "slackAllowedChannels"],
        discord: ["discordBotToken", "discordAllowedGuilds", "discordAllowedUsers", "discordAllowedChannels"],
        webhook: ["webhookUrl", "webhookSecret", "webhookAllowedUsers", "webhookAllowedChannels"],
        whatsapp: ["whatsappPhoneNumberId", "whatsappAccessToken", "whatsappAllowedUsers", "whatsappAllowedChannels"],
        dingtalk: ["dingtalkAppKey", "dingtalkAppSecret", "dingtalkRobotSecret", "dingtalkAllowedUsers", "dingtalkAllowedChats"],
        qq_bot: ["qqBotAppId", "qqBotSecret", "qqBotAllowedUsers", "qqBotAllowedGuilds", "qqBotAllowedChannels"],
        wechat_mp: ["wechatMpAppId", "wechatMpAppSecret", "wechatMpAllowedUsers", "wechatMpAllowedChats"],
        wecom: ["wecomAppId", "wecomAppSecret", "wecomAgentId", "wecomAllowedUsers", "wecomAllowedChats"]
      };

      // Remove fields of all channels EXCEPT the newly selected one
      Object.keys(channelFieldGroups).forEach(ch => {
        if (ch !== id) {
          channelFieldGroups[ch].forEach(field => {
            delete (updated as any)[field];
          });
        }
      });

      // Clear lark explicitly
      if (id !== "feishu" && id !== "lark") {
        delete (updated as any).larkAppId;
        delete (updated as any).larkAppSecret;
      }

      // If "none" or "web", clear allowMode and gatewayAllowAllUsers
      if (id === "none" || id === "web") {
        updated.gatewayAllowAllUsers = false;
        updated.allowMode = "disabled";
      }

      // If "feishu", set feishuRegion default
      if (id === "feishu") {
        updated.feishuRegion = d.feishuRegion || "feishu";
      }

      return updated;
    });
  };

  const update = (k: keyof SetupFormData, v: any) => {
    if (k === "channel" && !isChannelAllowedByPlan(v)) {
      setTestResults((tr: any) => ({
        ...tr,
        channel: { loading: false, result: { success: false, error: planChannelRestrictionMessage } }
      }));
      return;
    }
    setData(d => ({
      ...d,
      [k]: v,
    }));
    if (k === "template_id" && v === null) {
      handleClearTemplate();
    }
    if (['provider', 'model', 'baseUrl', 'providerApiKey', 'providerCredentialId', 'isCustomModel'].includes(k)) {
      setTestResults((tr: any) => ({ ...tr, llm: undefined }));
    }
    if (['channel', 'telegramBotToken', 'feishuAppId', 'feishuAppSecret', 'feishuRegion', 'weixinAccountId', 'weixinToken', 'slackBotToken', 'slackSigningSecret', 'slackAppToken', 'webhookUrl', 'webhookSecret'].includes(k)) {
      setTestResults((tr: any) => ({ ...tr, channel: undefined }));
    }
  };

  const updateTemplateInput = (fieldKey: string, value: any) => {
    if (import.meta.env.DEV) {
      console.log("[updateTemplateInput]", { fieldKey, value });
    }
    setData(prev => ({
      ...prev,
      template_inputs: {
        ...(prev.template_inputs || {}),
        [fieldKey]: value,
      },
    }));
  };

  const applyTemplate = (preset: any) => {
    const safePreset = { ...preset };
    if (!isChannelAllowedByPlan(safePreset.channel)) {
      safePreset.channel = "web";
    }
    safePreset.modelBillingMode = "byok";
    delete safePreset.platformModelId;
    delete safePreset.platformModelName;
    setData(d => ({
      ...d,
      ...safePreset,
      password: d.password || ""
    }));
  };

  useEffect(() => {
    if (!isChannelAllowedByPlan(data.channel)) {
      handleChannelChange("web");
    }
  }, [externalChannelsAllowed, data.channel]);

  const submit = async () => {
    if (quota.entitlementsReady && !quota.canCreateInstance) {
      setSubmitError(quotaStatusText);
      return;
    }

    if (!isChannelAllowedByPlan(data.channel)) {
      setSubmitError(planChannelRestrictionMessage);
      return;
    }
    setLoading(true);
    setSubmitError(null);
    try {
      const request = buildLocalDeploymentRequest({
        draft: data,
        idempotencyKey,
        permissionConfirmed: trustPermissionConfirmed,
      });
      const result = await api.post(request.path, request.body, request.options);
      if (result && result.initialDashboardCredentials) {
        sessionStorage.setItem(
          "one_time_credentials_instance_" + result.id,
          JSON.stringify(result.initialDashboardCredentials)
        );
      }
      setCreatedInstance({ ...result, deploymentStatus: result.status || "queued", currentStep: "queued", progress: 5 });
      setStep(7); // Go to Success page
    } catch (e: any) {
      console.error(e);
      setSubmitError(e.message || t("validation.submit_error"));
    } finally {
      setLoading(false);
    }
  };

  const retryDeployment = async () => {
    if (!createdInstance?.deploymentTaskId) return;
    setLoading(true);
    try {
      await api.post(`/api/deployments/${createdInstance.deploymentTaskId}/retry`);
      setCreatedInstance((current: any) => ({ ...current, deploymentStatus: "retry_wait", currentStep: "queued", progress: 5, errorCode: null, errorMessage: null }));
    } catch (error: any) {
      setSubmitError(error.message || "Retry failed.");
    } finally {
      setLoading(false);
    }
  };
  const next = () => {
    setStep(s => Math.min(7, s + 1));
  };
  
  const prev = () => setStep(s => Math.max(0, s - 1));

  // Determine current step validate and disable parameters
  let nextDisabled = false;
  let disableReason: string | null = null;

  if (step === 0) {
    const hasFail = preflight?.checks?.some((c: any) => c.status === "fail");
    if (!preflight) {
      nextDisabled = true;
      disableReason = t("validation.preflight_loading");
    } else if (hasFail) {
      nextDisabled = true;
      disableReason = t("validation.preflight_fail");
    }
  } else if (step === 1) {
    const dashboardAccessEnabled = data.enableDashboard !== false;
    if (!data.name) {
      nextDisabled = true;
      disableReason = t("validation.basic_name_missing");
    } else if (dashboardAccessEnabled && (!data.username || !data.password)) {
      nextDisabled = true;
      disableReason = t("validation.dashboard_access_missing");
    } else if (dashboardAccessEnabled && !/^[a-zA-Z0-9_-]+$/.test(data.username || "")) {
      nextDisabled = true;
      disableReason = t("validation.username_format");
    } else if (dashboardAccessEnabled && (data.password || "").length < 8) {
      nextDisabled = true;
      disableReason = t("validation.pwd_min");
    } else if (data.template_id && data.template_consent_ok === false) {
      nextDisabled = true;
      disableReason = t("validation.template_consent_required");
    }
  } else if (step === 3) {
    const success = testResults.llm?.result?.success;
    if (!success) {
      nextDisabled = true;
      disableReason = t("validation.test_llm_first");
    }
  } else if (step === 4) {
    const needsChannelTest = data.channel && data.channel !== "none" && data.channel !== "web";
    const success = testResults.channel?.result?.success;
    if (needsChannelTest && !success) {
      nextDisabled = true;
      disableReason = t("validation.test_channel_first");
    }
  } else if (step === 6 && !trustPermissionConfirmed) {
    nextDisabled = true;
    disableReason = t("trustPermission.confirmRequired");
  }

  // Feishu capability validation to prevent incompatible configurations
  const isFeishuChannel = data.channel === "feishu" || data.channel === "lark";
  const isLatest = !data.imageTag || data.imageTag === "latest";
  
  // Find family version object corresponding to the selected tag
  const selectedVersionObj = versions.find(v => {
    if (v.image_tag === data.imageTag || v.tag === data.imageTag || v.version === data.imageTag) return true;
    if (v.coreVariant?.tag === data.imageTag || v.feishuVariant?.tag === data.imageTag) return true;
    return false;
  });

  const isFeishuCapable = isLatest || (selectedVersionObj ? (
    selectedVersionObj.capabilities?.includes("feishu") || 
    selectedVersionObj.feishu_capable === true || 
    (data.imageTag && typeof data.imageTag === 'string' && (data.imageTag.toLowerCase().includes("feishu") || data.imageTag.toLowerCase().includes("lark")))
  ) : false);

  if (isFeishuChannel && step >= 2) {
    if (!isLatest && (!selectedVersionObj || !isFeishuCapable)) {
      nextDisabled = true;
      disableReason = t("validation.feishu_variant_required");
    }
  }

  // Stepper steps definitions
  const stepsDefs = [
    { title: t("steps.preflight.title"), desc: t("steps.preflight.desc") },
    { title: t("steps.basic.title"), desc: t("steps.basic.desc") },
    { title: t("steps.container.title"), desc: t("steps.container.desc") },
    { title: t("steps.model.title"), desc: t("steps.model.desc") },
    { title: t("steps.channel.title"), desc: t("steps.channel.desc") },
    { title: t("steps.skills.title"), desc: t("steps.skills.desc") },
    { title: t("steps.deploy.title"), desc: t("steps.deploy.desc") },
    { title: t("steps.complete.title"), desc: t("steps.complete.desc") }
  ];

  // Dynamic step status calculations
  const stepStatuses: StepStatus[] = stepsDefs.map((_, i) => {
    if (i === step) return "current";
    if (i < step) {
      if (i === 0 && preflight?.checks?.some((c: any) => c.status === "fail")) return "error";
      if (i === 1 && (!data.name || !data.username || !data.password || data.password.length < 8)) return "error";
      if (i === 3 && !testResults.llm?.result?.success) return "error";
      if (i === 4 && data.channel && data.channel !== "none" && data.channel !== "web" && !testResults.channel?.result?.success) return "error";
      return "completed";
    }
    return "pending";
  });

  // Main UI components dispatcher helper
  const renderStepContent = () => {
    switch (step) {
      case 0:
        return (
          <div className="space-y-4">
            <PreflightStep 
              preflight={preflight} 
              onRefresh={runPreflight} 
              loading={!preflight} 
            />
          </div>
        );
      case 1:
        return (
          <InstanceInfoStep 
            data={data} 
            update={update} 
            updateTemplateInput={updateTemplateInput}
            currentUser={currentUser}
            activeBlueprint={templateWorkflowsEnabled ? activeBlueprint : null}
            onClearTemplate={templateWorkflowsEnabled ? handleClearTemplate : undefined}
            applyTemplate={templateWorkflowsEnabled ? ((t) => {
              const hasPermissions = t.required_permissions && t.required_permissions.length > 0;
              const presetConfig = {
                template_id: t.id,
                template_slug: t.slug || t.id,
                name: `${t.name}-${Math.random().toString(36).substring(7).toUpperCase()}`,
                username: "admin",
                prompt: t.default_prompt || "",
                provider: t.default_provider || "",
                model: t.default_model || "",
                channel: t.default_channel || "web",
                skills: t.default_skills || [],
                template_inputs: {} as any,
                template_consent_ok: !hasPermissions
              };
              
              if (t.required_inputs) {
                const defaults: any = {};
                for (const input of t.required_inputs) {
                  const fieldKey = input.key || input.name || input.id;
                  if (!fieldKey) {
                    console.error("[DeployWizard] Template input is missing persistent key/name/id!", input);
                    continue;
                  }
                  if (input.type === "select") {
                    defaults[fieldKey] = input.defaultValue ?? input.default_value ?? input.options?.[0]?.value ?? "";
                  } else if (input.type === "boolean") {
                    defaults[fieldKey] = typeof input.defaultValue === "boolean" ? input.defaultValue : (input.default_value === true);
                  } else {
                    defaults[fieldKey] = input.defaultValue ?? input.default_value ?? "";
                  }
                }
                presetConfig.template_inputs = defaults;
              }
              
              setData(d => ({
                ...d,
                ...presetConfig,
                password: d.password || ""
              }));
              
              setActiveWorkflowTemplate(t);
              setActiveBlueprint(null);
              setTestResults({});

              if (onUpdateTemplateParams) {
                onUpdateTemplateParams({
                  template_type: "workflow",
                  template_id: t.id
                });
              }
            }) : undefined}
          />
        );
      case 2:
        return (
          <ContainerConfigStep 
            data={data} 
            update={update} 
            preflight={preflight} 
            versions={versions}
            currentUser={currentUser}
            activeBlueprint={activeBlueprint}
            advancedResourceConfigEnabled={advancedResourceConfigEnabled}
          />
        );
      case 3:
        return (
          <ModelStep 
            data={data} 
            update={update} 
            testLLM={testLLM} 
            testStatus={testResults.llm} 
            currentUser={currentUser}
          />
        );
      case 4:
        return (
          <ChannelStep 
            data={data} 
            update={update} 
            testChannel={testChannel} 
            testStatus={testResults.channel} 
            onViewGuide={onViewGuide}
            versions={versions}
            handleChannelChange={handleChannelChange}
            isChannelAllowed={isChannelAllowedByPlan}
            externalChannelsAllowed={externalChannelsAllowed}
          />
        );
      case 5:
        return (
          <SkillsStep 
            data={data} 
            update={update} 
            testSkill={testSkill} 
            testResults={testResults} 
            currentUser={currentUser}
          />
        );
      case 6:
      case 7:
        return (
          <DeployReviewStep 
            step={step} 
            data={data} 
            createdInstance={createdInstance} 
            testResults={testResults} 
            onSuccess={onSuccess} 
            submitError={submitError}
            onRetry={retryDeployment}
            isTraefik={isTraefik}
            onViewGuide={onViewGuide}
            activeWorkflowTemplate={activeWorkflowTemplate}
            activeBlueprint={activeBlueprint}
            permissionConfirmed={trustPermissionConfirmed}
            onPermissionConfirmedChange={setTrustPermissionConfirmed}
          />
        );
      default:
        return null;
    }
  };

  // Dynamic footer text & type calculation based on step and form states
  let footerStatus: { text: string; type: "error" | "warning" | "success" | "info" } | null = null;
  if (step === 0) {
    if (!preflight) {
      footerStatus = { text: t("footer_status.preflight_loading"), type: "info" };
    } else {
      const failChecks = preflight.checks?.filter((c: any) => c.status === "fail") || [];
      const warnChecks = preflight.checks?.filter((c: any) => c.status === "warn") || [];
      if (failChecks.length > 0) {
        const failingNames = failChecks.map((c: any) => {
          const safeName = typeof c?.name === "string" ? c.name : (typeof c?.key === "string" ? c.key : "Unknown check");
          const nameLower = safeName.toLowerCase();
          if (nameLower.includes("docker") || nameLower.includes("socket")) return "Docker Socket";
          if (nameLower.includes("domain") || nameLower.includes("base_domain")) return "BASE_DOMAIN";
          if (nameLower.includes("encrypt") || nameLower.includes("encryption")) return "ENCRYPTION_KEY";
          return safeName;
        }).join(", ");
        footerStatus = { text: t("footer_status.preflight_fix", { fields: failingNames }), type: "error" };
      } else if (warnChecks.length > 0) {
        footerStatus = { text: t("footer_status.preflight_warning"), type: "warning" };
      } else {
        footerStatus = { text: t("footer_status.preflight_success"), type: "success" };
      }
    }
  } else if (step === 1) {
    const dashboardAccessEnabled = data.enableDashboard !== false;
    if (!data.name) {
      footerStatus = { text: t("footer_status.basic_name"), type: "info" };
    } else if (dashboardAccessEnabled && (!data.username || !data.password)) {
      footerStatus = { text: t("footer_status.dashboard_access"), type: "info" };
    } else if (dashboardAccessEnabled && !/^[a-zA-Z0-9_-]+$/.test(data.username || "")) {
      footerStatus = { text: t("footer_status.basic_format_error"), type: "error" };
    } else if (dashboardAccessEnabled && (data.password || "").length < 8) {
      footerStatus = { text: t("footer_status.basic_pwd_error"), type: "error" };
    } else {
      footerStatus = { text: dashboardAccessEnabled ? t("footer_status.dashboard_access_configured") : t("footer_status.dashboard_access_disabled"), type: "success" };
    }
  } else if (step === 2) {
    footerStatus = { text: isTraefik ? t("footer_status.container_traefik") : t("footer_status.container_port"), type: "success" };
  } else if (step === 3) {
    if (!testResults.llm?.result?.success) {
      footerStatus = { text: t("footer_status.model_test_required"), type: "info" };
    } else {
      footerStatus = { text: t("footer_status.model_success"), type: "success" };
    }
  } else if (step === 4) {
    const hasChannel = data.channel && data.channel !== "none" && data.channel !== "web";
    if (hasChannel && !testResults.channel?.result?.success) {
      footerStatus = { text: t("footer_status.channel_test_required"), type: "info" };
    } else {
      const isTelegramEmpty = data.channel === "telegram" && !(data.telegramAllowedUsers || "").trim() && !(data.telegramAllowedChats || "").trim();
      const isFeishuEmpty = data.channel === "feishu" && !(data.feishuAllowedUsers || "").trim() && !(data.feishuAllowedChats || "").trim();
      const isSlackEmpty = data.channel === "slack" && !(data.slackAllowedUsers || "").trim() && !(data.slackAllowedChannels || "").trim();
      const isDiscordEmpty = data.channel === "discord" && !(data.discordAllowedGuilds || "").trim() && !(data.discordAllowedUsers || "").trim() && !(data.discordAllowedChannels || "").trim();
      const isWebhookEmpty = data.channel === "webhook" && !(data.webhookAllowedUsers || "").trim() && !(data.webhookAllowedChannels || "").trim();
      const isAllowModeAllowlist = data.allowMode === "allowlist";
      const isAllowlistEmpty = hasChannel && isAllowModeAllowlist && !data.gatewayAllowAllUsers && (isTelegramEmpty || isFeishuEmpty || isSlackEmpty || isDiscordEmpty || isWebhookEmpty);

      if (isAllowlistEmpty) {
        footerStatus = { text: t("footer_status.channel_empty_allowlist"), type: "warning" };
      } else {
        footerStatus = { text: hasChannel ? t("footer_status.channel_success") : t("footer_status.channel_disabled"), type: "success" };
      }
    }
  } else if (step === 5) {
    footerStatus = { text: t("footer_status.skills_checking"), type: "info" };
  } else if (step === 6) {
    const hasChannel = data.channel && data.channel !== "none" && data.channel !== "web";
    const isTelegramEmpty = data.channel === "telegram" && !(data.telegramAllowedUsers || "").trim() && !(data.telegramAllowedChats || "").trim();
    const isFeishuEmpty = data.channel === "feishu" && !(data.feishuAllowedUsers || "").trim() && !(data.feishuAllowedChats || "").trim();
    const isSlackEmpty = data.channel === "slack" && !(data.slackAllowedUsers || "").trim() && !(data.slackAllowedChannels || "").trim();
    const isDiscordEmpty = data.channel === "discord" && !(data.discordAllowedGuilds || "").trim() && !(data.discordAllowedUsers || "").trim() && !(data.discordAllowedChannels || "").trim();
    const isWebhookEmpty = data.channel === "webhook" && !(data.webhookAllowedUsers || "").trim() && !(data.webhookAllowedChannels || "").trim();
    const isAllowModeAllowlist = data.allowMode === "allowlist";
    const isAllowlistEmpty = hasChannel && isAllowModeAllowlist && !data.gatewayAllowAllUsers && (isTelegramEmpty || isFeishuEmpty || isSlackEmpty || isDiscordEmpty || isWebhookEmpty);

    if (isAllowlistEmpty) {
      footerStatus = { text: t("footer_status.channel_empty_allowlist"), type: "warning" };
    } else {
      footerStatus = { text: quota.entitlementsReady ? quotaStatusText : t("footer_status.review_success"), type: quota.entitlementsReady && !quota.canCreateInstance ? "error" : "success" };
    }
  }

  if (step === 6 && quota.entitlementsReady && !quota.canCreateInstance) {
    nextDisabled = true;
    disableReason = quotaStatusText;
  }

  return (
    <div className="w-full xl:max-w-[1180px] lg:max-w-5xl md:max-w-4xl mx-auto flex flex-col bg-surface md:border border-outline/80 md:rounded-3xl md:shadow-2xl overflow-hidden md:h-[86vh] md:max-h-[88vh] min-h-[100dvh] md:min-h-[500px] absolute md:relative top-0 left-0 right-0 bottom-0 z-50 md:z-auto animate-in fade-in md:zoom-in-95 duration-200">
      
      {/* 1. Header (Static/Fixed) */}
      <div className="px-5 md:px-8 py-5 md:py-6 border-b border-outline bg-surface flex flex-col sm:flex-row justify-between sm:items-center gap-4 md:h-[84px] shrink-0 sticky top-0 z-30 shadow-sm sm:shadow-none">
        <div className="space-y-1 sm:space-y-1.5 flex-1 min-w-0">
          <h1 className="text-xl md:text-2xl font-black text-content tracking-tight flex items-center gap-2.5 leading-none">
            <div className="p-1.5 bg-blue-50 dark:bg-blue-950/40 rounded-lg shrink-0">
              <Activity className="w-4 h-4 md:w-5 md:h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <span className="truncate">{t("wizard_header.title")}</span>
          </h1>
          <p className="text-[13px] font-medium text-content-muted leading-tight">
            {t("wizard_header.desc")}
          </p>
        </div>
        
        <div className="shrink-0 flex items-center gap-2 sm:gap-3">
          {step === 0 && onBackToSelection && (
            <button
              onClick={onBackToSelection}
              className="text-[13px] text-content-secondary hover:text-content bg-surface-muted hover:bg-outline px-3 py-1.5 rounded-full font-bold transition-all cursor-pointer"
            >
              {t("path_selection.back_to_selection")}
            </button>
          )}
          <span className="text-[13px] text-slate-500 dark:text-slate-300 font-black bg-surface-muted/80 px-3 py-1.5 rounded-full border border-outline/50">
            {t("wizard_header.progress", { current: step + 1, total: 8 })}
          </span>
          {step > 0 && step < 7 && (
            <button
              onClick={() => setStep(0)}
              className="text-[13px] text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/50 px-3 py-1.5 rounded-full font-bold transition-all"
            >
              {t("wizard_header.restart")}
            </button>
          )}
        </div>
      </div>

      {/* 2. Body Split Pane: Left Vertical Stepper + Right Panel (With Custom Scroll Areas) */}
      <div className="flex-1 flex flex-col md:flex-row md:overflow-hidden min-h-0 relative">
        
        {/* Left Side Navigation (width 240px) */}
        <div className="w-full md:w-[240px] bg-surface-muted/60 border-b md:border-b-0 md:border-r border-outline shrink-0 md:h-full md:overflow-y-auto style-slim-scrollbar hidden md:block">
          <WizardStepper 
            steps={stepsDefs} 
            currentStep={step} 
            statuses={stepStatuses} 
            onStepClick={(i) => setStep(i)} 
          />
        </div>

        {/* Mobile top progress bar as stepper replacement */}
        <div className="md:hidden w-full h-1 bg-surface-muted shrink-0">
          <div 
            className="h-full bg-blue-500 transition-all duration-300" 
            style={{ width: `${((step + 1) / stepsDefs.length) * 100}%` }}
          />
        </div>

        {/* Right Side Content Panel */}
        <div className="flex-1 flex flex-col md:h-full bg-surface relative overflow-hidden min-h-0">
          <div className="flex-1 overflow-y-auto w-full p-4 sm:p-6 md:px-8 md:py-8 relative z-0 style-slim-scrollbar">
            <div className="max-w-[880px] mx-auto w-full pb-12 sm:pb-8">
              {/* Step 0 Lightweight Context Prompt Card */}
              {step === 0 && (activeWorkflowTemplate || activeBlueprint) && (
                <div className="mb-6 p-4 bg-surface-muted border border-outline/80 rounded-2xl shadow-sm flex items-center justify-between gap-3 text-left">
                  <div className="flex items-center gap-2.5">
                    {activeBlueprint ? (
                      <Compass className="w-5 h-5 text-indigo-500 shrink-0 animate-pulse" />
                    ) : (
                      <Sparkles className="w-5 h-5 text-emerald-500 shrink-0 animate-pulse" />
                    )}
                    <div className="text-[13px] font-bold leading-relaxed text-content-secondary">
                      {activeBlueprint ? (
                        i18n.language && i18n.language.startsWith("zh") ? (
                          <span>{t("wizardCopy.templateStatus.blueprint", { name: activeBlueprint.name })}</span>
                        ) : (
                          <span>{t("wizardCopy.templateStatus.blueprint", { name: activeBlueprint.name })}</span>
                        )
                      ) : (
                        i18n.language && i18n.language.startsWith("zh") ? (
                          <span>{t("wizardCopy.templateStatus.workflow", { name: activeWorkflowTemplate.name })}</span>
                        ) : (
                          <span>{t("wizardCopy.templateStatus.workflow", { name: activeWorkflowTemplate.name })}</span>
                        )
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      handleClearTemplate();
                      if (onClearTemplateParams) {
                        onClearTemplateParams();
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-black text-rose-600 dark:text-rose-300 hover:text-white bg-white dark:bg-rose-950/25 hover:bg-rose-600 dark:hover:bg-rose-900/40 border border-rose-200 dark:border-rose-800/50 hover:border-rose-600 dark:hover:border-rose-700 rounded-xl transition-all duration-150 shadow-sm cursor-pointer shrink-0"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>{t("business_summary_card.exit_btn")}</span>
                  </button>
                </div>
              )}

              {step > 0 && step < 7 && (activeWorkflowTemplate || activeBlueprint) && (
                <div className="mb-6 p-5 bg-gradient-to-br from-indigo-50/60 to-blue-50/30 dark:from-indigo-950/20 dark:to-blue-950/10 border border-indigo-150/65 dark:border-slate-800 rounded-2xl animate-in fade-in duration-200 shadow-sm flex flex-col gap-4">
                  {/* Title Row */}
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-indigo-100/60 dark:border-slate-800 pb-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-400 rounded-xl">
                        {activeBlueprint ? (
                          <Compass className="w-5 h-5" />
                        ) : (
                          <Terminal className="w-5 h-5" />
                        )}
                      </div>
                      <div className="text-left">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-black text-indigo-700 dark:text-indigo-300 uppercase tracking-wide px-1.5 py-0.5 bg-indigo-100/60 dark:bg-indigo-950/40 rounded-md border border-indigo-200/50 dark:border-indigo-900/50">
                            {activeBlueprint ? t("business_summary_card.title_blueprint") : t("business_summary_card.title_workflow")}
                          </span>
                          <span className="text-[11px] font-bold text-content-muted">
                            {t("business_summary_card.step_hint", { current: step + 1, total: 8 })}
                          </span>
                        </div>
                        <h4 className="text-base font-black text-content mt-0.5">
                          {activeBlueprint ? activeBlueprint.name : activeWorkflowTemplate.name}
                        </h4>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        handleClearTemplate();
                        if (onClearTemplateParams) {
                          onClearTemplateParams();
                        }
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-black text-rose-600 dark:text-rose-300 hover:text-white bg-white dark:bg-rose-950/25 hover:bg-rose-600 dark:hover:bg-rose-900/40 border border-rose-200 dark:border-rose-800/50 hover:border-rose-600 dark:hover:border-rose-700 rounded-xl transition-all duration-150 shadow-sm cursor-pointer shrink-0 self-end sm:self-center"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>{t("business_summary_card.exit_btn")}</span>
                    </button>
                  </div>

                  {/* Mid Row: Business Metadata & Auto-completion status */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[13px]">
                    {/* Business specification */}
                    <div className="bg-surface/50 border border-indigo-100/40 dark:border-slate-800 p-3.5 rounded-xl space-y-2.5">
                      <div className="flex items-center gap-1.5 text-indigo-950 dark:text-indigo-300 font-bold border-b border-indigo-100/30 dark:border-slate-800 pb-1.5">
                        <Users className="w-4 h-4 text-indigo-650 dark:text-indigo-400" />
                        <span>
                          {activeBlueprint 
                            ? t("business_summary_card.blueprint_desc_title") 
                            : t("business_summary_card.workflow_desc_title")}
                        </span>
                      </div>
                      <p className="text-content-secondary text-[13px] leading-relaxed">
                        {activeBlueprint 
                          ? (activeBlueprint.description || activeBlueprint.use_case) 
                          : (activeWorkflowTemplate.description || activeWorkflowTemplate.use_case)}
                      </p>
                      
                      <div className="space-y-1.5 text-[13px] text-content-muted pt-1.5">
                        <div className="flex items-start gap-1">
                          <strong className="text-content-secondary font-bold shrink-0">
                            {t("business_summary_card.target_audience")}:
                          </strong>
                          <span>
                            {activeBlueprint?.target_audience || activeWorkflowTemplate?.target_audience || t("business_summary_card.target_audience_default")}
                          </span>
                        </div>
                        <div className="flex items-start gap-1">
                          <strong className="text-content-secondary font-bold shrink-0">
                            {t("business_summary_card.business_value")}:
                          </strong>
                          <span>
                            {(() => {
                              const val = activeBlueprint 
                                ? activeBlueprint.business_value 
                                : (activeWorkflowTemplate.automation_result || activeWorkflowTemplate.business_value);
                              if (Array.isArray(val)) return val.join(", ");
                              return val || t("business_summary_card.business_value_default");
                            })()}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Dynamic completion status */}
                    <div className="bg-surface/50 border border-indigo-100/40 dark:border-slate-800 p-3.5 rounded-xl space-y-2.5">
                      <div className="flex items-center gap-1.5 text-indigo-950 dark:text-indigo-300 font-bold border-b border-indigo-100/30 dark:border-slate-800 pb-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span>{t("business_summary_card.coverage_title")}</span>
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2 text-[13px]">
                        {/* Auto-configured */}
                        <div className="space-y-1.5">
                          <span className="text-[11px] font-bold text-slate-400 block">
                            {t("business_summary_card.auto_configured")}
                          </span>
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 text-emerald-700 font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                              <span>{t("business_summary_card.status_model")}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-emerald-700 font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                              <span>{t("business_summary_card.status_prompt")}</span>
                            </div>
                            {data.channel && data.channel !== "none" && data.channel !== "web" && (
                              <div className="flex items-center gap-1.5 text-emerald-700 font-medium">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                <span>{t("business_summary_card.status_channel")}</span>
                              </div>
                            )}
                            {data.skills && data.skills.length > 0 && (
                              <div className="flex items-center gap-1.5 text-emerald-700 font-medium">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                <span>{t("business_summary_card.status_skills")}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Pending Confirmation */}
                        <div className="space-y-1.5">
                          <span className="text-[11px] font-bold text-slate-400 block">
                            {t("business_summary_card.pending_configure")}
                          </span>
                          <div className="space-y-1">
                            {/* Required Business inputs for workflows */}
                            {activeWorkflowTemplate?.required_inputs?.length > 0 && (
                              <div className="flex items-center gap-1.5 font-medium">
                                {data.template_inputs_error ? (
                                  <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                ) : (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                )}
                                <span className={data.template_inputs_error ? "text-amber-800" : "text-emerald-700"}>
                                  {t("business_summary_card.status_inputs")}
                                </span>
                              </div>
                            )}

                            {/* Master credentials check */}
                            {(() => {
                              const hasCredentials = !!(data.name && data.username && data.password && data.password.length >= 8);
                              return (
                                <div className="flex items-center gap-1.5 font-medium">
                                  {hasCredentials ? (
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                  ) : (
                                    <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                  )}
                                  <span className={hasCredentials ? "text-emerald-700" : "text-amber-800"}>
                                    {t("business_summary_card.status_credentials")}
                                  </span>
                                </div>
                              );
                            })()}

                            {/* Safety Consent confirmation */}
                            {activeWorkflowTemplate?.required_permissions?.length > 0 && (
                              <div className="flex items-center gap-1.5 font-medium">
                                {data.template_consent_ok ? (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                ) : (
                                  <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                )}
                                <span className={data.template_consent_ok ? "text-emerald-700" : "text-amber-800"}>
                                  {t("business_summary_card.status_consent")}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {renderStepContent()}
            </div>
          </div>
        </div>

      </div>

      {/* 3. Footer (Static/Fixed) */}
      <WizardFooter 
        step={step} 
        loading={loading} 
        onPrev={prev} 
        onNext={next} 
        onCancel={onSuccess} 
        onSubmit={submit} 
        nextDisabled={nextDisabled} 
        disableReason={disableReason} 
        statusMessage={footerStatus}
      />

    </div>
  );
}


