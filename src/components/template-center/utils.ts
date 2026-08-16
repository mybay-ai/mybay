import { IndustryBlueprint, WorkflowTemplate, BlueprintProductDetail, WorkflowProductDetail } from "./types";
import { BLUEPRINT_MARKETING_MAP, WORKFLOW_MARKETING_MAP } from "./constants";

export function formatTemplatePlugin(value: string, lang: string): string {
  const isEn = lang === "en";
  const normalized = value.toLowerCase().trim();
  if (normalized === "browser") return isEn ? "Browser" : "浏览器";
  if (normalized === "file_system" || normalized === "file-system") return isEn ? "File System" : "文件系统";
  if (normalized === "web_search" || normalized === "web-search") return isEn ? "Web Search" : "网络搜索";
  return value;
}

export function formatTemplateChannel(value: string, lang: string): string {
  const isEn = lang === "en";
  const normalized = value.toLowerCase().trim();
  if (normalized === "feishu") return isEn ? "Feishu" : "飞书";
  if (normalized === "telegram") return "Telegram";
  if (normalized === "discord") return "Discord";
  if (normalized === "qqbot") return "QQBot";
  if (normalized === "dingtalk") return isEn ? "DingTalk" : "钉钉";
  return value;
}

export function formatTemplatePluginsList(skills: string[], lang: string): string {
  if (!skills || skills.length === 0) return "";
  return skills.map(s => formatTemplatePlugin(s, lang)).join("/");
}

export function formatTemplateChannelsList(channels: string[], lang: string): string {
  if (!channels || channels.length === 0) return "";
  return channels.map(c => formatTemplateChannel(c, lang)).join("/");
}

export const getLocalizedBlueprint = (
  blueprint: IndustryBlueprint,
  t: (key: string, defaultValueOrOptions?: any) => any
): IndustryBlueprint => {
  if (!blueprint) return blueprint;
  const baseKey = `template_center.templates.${blueprint.id.replace(/-/g, "_")}`;
  
  const name = t(`${baseKey}.name`, blueprint.name);
  const description = t(`${baseKey}.description`, blueprint.description);
  const targetAudience = t(`${baseKey}.audience`, blueprint.target_audience);
  const businessValue = t(`${baseKey}.business_value`, blueprint.business_value);
  
  const businessImpact = t(`${baseKey}.business_impact`, { returnObjects: true });
  const preparationNotice = t(`${baseKey}.preparation_notice`, { returnObjects: true });
  const limitations = t(`${baseKey}.limitations`, blueprint.limitations);
  const postDeployGuide = t(`${baseKey}.post_deploy_guide`, { returnObjects: true });
  const readinessChecklist = t(`${baseKey}.readiness_checklist`, { returnObjects: true });
  
  return {
    ...blueprint,
    name,
    description,
    target_audience: targetAudience || blueprint.target_audience,
    business_value: (Array.isArray(businessImpact) ? businessImpact : undefined) || businessValue || blueprint.business_value,
    limitations: (typeof limitations === "string" && limitations !== `${baseKey}.limitations` ? limitations : undefined) || blueprint.limitations,
    post_deploy_guide: (Array.isArray(postDeployGuide) ? postDeployGuide : undefined) || blueprint.post_deploy_guide,
    readiness_checklist: (Array.isArray(readinessChecklist) ? readinessChecklist : undefined) || blueprint.readiness_checklist,
    required_setup_items: (Array.isArray(preparationNotice) ? preparationNotice : undefined) || blueprint.required_setup_items
  };
};

export const getLocalizedWorkflow = (
  workflow: WorkflowTemplate,
  t: (key: string, defaultValueOrOptions?: any) => any
): WorkflowTemplate => {
  if (!workflow) return workflow;
  const baseKey = `template_center.templates.${workflow.id.replace(/-/g, "_")}`;
  
  const name = t(`${baseKey}.name`, workflow.name);
  const description = t(`${baseKey}.description`, workflow.description);
  const targetAudience = t(`${baseKey}.audience`, workflow.target_audience);
  const automationResult = t(`${baseKey}.automation_result`, workflow.automation_result);
  const businessValue = t(`${baseKey}.business_value`, workflow.business_value);
  
  const limitations = t(`${baseKey}.limitations`, workflow.limitations);
  const postDeployGuide = t(`${baseKey}.post_deploy_guide`, { returnObjects: true });
  const setupSteps = t(`${baseKey}.setup_steps`, { returnObjects: true });
  const readinessChecklist = t(`${baseKey}.readiness_checklist`, { returnObjects: true });
  
  return {
    ...workflow,
    name,
    description,
    target_audience: targetAudience || workflow.target_audience,
    automation_result: automationResult || workflow.automation_result,
    business_value: businessValue || workflow.business_value,
    limitations: (typeof limitations === "string" && limitations !== `${baseKey}.limitations` ? limitations : undefined) || workflow.limitations,
    post_deploy_guide: (Array.isArray(postDeployGuide) ? postDeployGuide : undefined) || workflow.post_deploy_guide,
    setup_steps: (Array.isArray(setupSteps) ? setupSteps : undefined) || workflow.setup_steps,
    readiness_checklist: (Array.isArray(readinessChecklist) ? readinessChecklist : undefined) || workflow.readiness_checklist
  };
};

export const getRiskLevelTranslationKey = (riskLevel: string | undefined | null): string => {
  if (!riskLevel) return "template_center.risk_unknown";
  const normalized = riskLevel.toLowerCase().trim();
  if (normalized === "low") return "template_center.risk_low";
  if (normalized === "medium") return "template_center.risk_medium";
  if (normalized === "high") return "template_center.risk_high";
  return "template_center.risk_unknown";
};

export const resolveBlueprintMarketingFallback = (
  blueprint: IndustryBlueprint,
  t: (key: string, defaultValue?: any) => any
): BlueprintProductDetail => {
  const mapData = BLUEPRINT_MARKETING_MAP[blueprint.id] || BLUEPRINT_MARKETING_MAP[blueprint.slug];
  const baseKey = `template_center.templates.${blueprint.id.replace(/-/g, "_")}`;

  const targetAudience = t(`${baseKey}.audience`, mapData?.targetAudience || t("template_center.modal.bp_fallback_target"));
  
  const businessImpact = (() => {
    const trans = t(`${baseKey}.business_impact`, { returnObjects: true });
    if (Array.isArray(trans)) return trans;
    return mapData?.businessImpact || [
      t("template_center.modal.bp_fallback_impact_1"),
      t("template_center.modal.bp_fallback_impact_2"),
      t("template_center.modal.bp_fallback_impact_3")
    ];
  })();

  const preparationNotice = (() => {
    const trans = t(`${baseKey}.preparation_notice`, { returnObjects: true });
    if (Array.isArray(trans)) return trans;
    return mapData?.preparationNotice || [
      t("template_center.modal.bp_fallback_prep_1"),
      t("template_center.modal.bp_fallback_prep_2")
    ];
  })();

  const techSpec = t(`${baseKey}.tech_spec`, mapData?.techSpec || t("template_center.modal.bp_fallback_tech_spec"));
  const limitations = t(`${baseKey}.limitations`, mapData?.limitations || "");

  return {
    targetAudience,
    businessImpact,
    preparationNotice,
    techSpec,
    limitations
  };
};

export const resolveWorkflowMarketingFallback = (
  workflow: WorkflowTemplate,
  t: (key: string, defaultValue?: any) => any
): WorkflowProductDetail => {
  const mapData = WORKFLOW_MARKETING_MAP[workflow.id];
  const baseKey = `template_center.templates.${workflow.id.replace(/-/g, "_")}`;

  const targetAudience = t(`${baseKey}.audience`, mapData?.targetAudience || t("template_center.modal.wf_fallback_target"));
  const automationResult = t(`${baseKey}.automation_result`, mapData?.automationResult || t("template_center.modal.wf_fallback_result"));
  
  const keyRequirements = (() => {
    const trans = t(`${baseKey}.key_requirements`, { returnObjects: true });
    if (Array.isArray(trans)) return trans;
    return mapData?.keyRequirements || [
      t("template_center.modal.wf_fallback_req_1"),
      t("template_center.modal.wf_fallback_req_2")
    ];
  })();

  const triggerMode = t(`${baseKey}.trigger_mode`, mapData?.triggerMode || t("template_center.modal.wf_fallback_trigger"));
  const limitations = t(`${baseKey}.limitations`, mapData?.limitations || "");
  const business_value = t(`${baseKey}.business_value`, mapData?.business_value || "");

  return {
    targetAudience,
    automationResult,
    keyRequirements,
    triggerMode,
    limitations,
    business_value
  };
};


export interface BlueprintCardContent {
  targetAudience: string;
  businessValuePreview: string;
}

export const resolveBlueprintCardContent = (
  blueprint: IndustryBlueprint,
  t: (key: string) => string
): BlueprintCardContent => {
  const bpMarketing = resolveBlueprintMarketingFallback(blueprint, t);
  const targetAudience = (blueprint.target_audience && blueprint.target_audience.trim()) || bpMarketing.targetAudience;
  
  let businessValuePreview = "";
  if (blueprint.business_value) {
    if (typeof blueprint.business_value === "string" && blueprint.business_value.trim()) {
      businessValuePreview = blueprint.business_value;
    } else if (Array.isArray(blueprint.business_value) && blueprint.business_value.length > 0) {
      businessValuePreview = blueprint.business_value[0];
    }
  }
  
  if (!businessValuePreview && bpMarketing.businessImpact && bpMarketing.businessImpact.length > 0) {
    businessValuePreview = bpMarketing.businessImpact[0];
  }

  return {
    targetAudience,
    businessValuePreview
  };
};

export interface WorkflowCardContent {
  targetAudience: string;
  automationResultPreview: string;
}

export const resolveWorkflowCardContent = (
  workflow: WorkflowTemplate,
  t: (key: string) => string
): WorkflowCardContent => {
  const wfMarketingDetail = resolveWorkflowMarketingFallback(workflow, t);
  const targetAudience = (workflow.target_audience && workflow.target_audience.trim()) || wfMarketingDetail.targetAudience;
  const automationResultPreview = (workflow.automation_result && workflow.automation_result.trim()) || wfMarketingDetail.automationResult;
  
  return {
    targetAudience,
    automationResultPreview
  };
};

export const safeParseArray = (val: any): string[] => {
  if (!val) return [];
  if (Array.isArray(val)) {
    return val.filter((item): item is string => typeof item === 'string' && item.trim() !== "");
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.filter((item): item is string => typeof item === 'string' && item.trim() !== "");
        }
      } catch (e) {
        // Fallback
      }
    }
    return [trimmed];
  }
  return [];
};

export const normalizeLimitations = (lim: string | string[] | undefined | null): string[] => {
  return safeParseArray(lim);
};

export const isFullyDatabaseContent = (item: any): boolean => {
  if (!item) return false;
  const targetAudienceOk = !!item.target_audience?.trim();
  
  const businessValueOk = (() => {
    if (!item.business_value) return false;
    if (typeof item.business_value === 'string') {
      const trimmed = item.business_value.trim();
      if (!trimmed) return false;
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        return safeParseArray(trimmed).length > 0;
      }
      return true;
    }
    if (Array.isArray(item.business_value)) {
      return item.business_value.filter((x: any) => typeof x === 'string' && x.trim() !== "").length > 0;
    }
    return false;
  })();

  const readinessChecklistOk = safeParseArray(item.readiness_checklist).length > 0;
  const postDeployGuideOk = safeParseArray(item.post_deploy_guide).length > 0 || safeParseArray(item.setup_steps).length > 0;
  const limitationsOk = safeParseArray(item.limitations).length > 0;
  
  const nextActions = (() => {
    if (!item.next_actions) return [];
    if (Array.isArray(item.next_actions)) {
      return item.next_actions.filter((x: any) => x && (typeof x === 'object' || (typeof x === 'string' && x.trim() !== "")));
    }
    if (typeof item.next_actions === "string") {
      const trimmed = item.next_actions.trim();
      if (!trimmed) return [];
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.filter((x: any) => x && (typeof x === 'object' || (typeof x === 'string' && x.trim() !== "")));
        }
      } catch {
        // Invalid JSON is treated as invalid content
        return [];
      }
    }
    return [];
  })();
  const nextActionsOk = nextActions.length > 0;

  return targetAudienceOk && businessValueOk && readinessChecklistOk && postDeployGuideOk && limitationsOk && nextActionsOk;
};

export function getReadinessMeta(readiness: string | undefined, t: (key: string, defaultValue?: any) => any) {
  const status = readiness || "llm_report_ready";
  switch (status) {
    case "ready":
      return {
        text: t("template_center.readiness.ready", "真实执行就绪"),
        bgClass: "bg-emerald-50 text-emerald-700 border-emerald-100/50 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900/30",
        dotClass: "bg-emerald-500"
      };
    case "llm_report_ready":
      return {
        text: t("template_center.readiness.llm_report_ready", "智能报告生成 (不触发后台底层真实操作)"),
        bgClass: "bg-indigo-50 text-indigo-700 border-indigo-100/50 dark:bg-indigo-950/30 dark:text-indigo-300 dark:border-indigo-900/30",
        dotClass: "bg-indigo-500"
      };
    case "simulated":
      return {
        text: t("template_center.readiness.simulated", "沙箱模拟 (前端虚拟流)"),
        bgClass: "bg-amber-50 text-amber-700 border-amber-100/50 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900/30",
        dotClass: "bg-amber-500"
      };
    case "requires_webhook":
      return {
        text: t("template_center.readiness.requires_webhook", "配置 Webhook 触发"),
        bgClass: "bg-blue-50 text-blue-700 border-blue-100/50 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-900/30",
        dotClass: "bg-blue-500"
      };
    case "requires_file_parser":
      return {
        text: t("template_center.readiness.requires_file_parser", "待解析文档"),
        bgClass: "bg-cyan-50 text-cyan-700 border-cyan-100/50 dark:bg-cyan-950/30 dark:text-cyan-300 dark:border-cyan-900/30",
        dotClass: "bg-cyan-500"
      };
    case "requires_channel_auth":
      return {
        text: t("template_center.readiness.requires_channel_auth", "待授权通讯渠道"),
        bgClass: "bg-purple-50 text-purple-700 border-purple-100/50 dark:bg-purple-950/30 dark:text-purple-300 dark:border-purple-900/30",
        dotClass: "bg-purple-500"
      };
    case "coming_soon":
      return {
        text: t("template_center.readiness.coming_soon", "敬请期待"),
        bgClass: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/60 dark:text-slate-400 dark:border-slate-700/60",
        dotClass: "bg-slate-400"
      };
    default:
      return {
        text: t("template_center.readiness.ready", "真实执行就绪"),
        bgClass: "bg-emerald-50 text-emerald-700 border-emerald-100/50 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900/30",
        dotClass: "bg-emerald-500"
      };
  }
}
