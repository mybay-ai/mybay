export type TemplateCapabilityLevel = "production" | "beta" | "demo" | "coming_soon";
export type WorkflowReadinessState = "ready" | "config_required" | "authorization_required" | "file_required" | "unavailable" | "failed";
export type RequirementType = "input" | "credential" | "authorization" | "file" | "channel" | "webhook" | "dependency";

export interface TemplateReadinessRequirement {
  type: RequirementType;
  key?: string;
  provider?: string;
  fileType?: string;
  required?: boolean;
  label?: string;
}

export interface TemplatePolicySource {
  id?: string;
  slug?: string;
  capability_level?: TemplateCapabilityLevel;
  readiness_requirements?: TemplateReadinessRequirement[] | null;
}

export interface WorkflowReadinessResult {
  state: WorkflowReadinessState;
  ready: boolean;
  missingRequirements: TemplateReadinessRequirement[];
  message: string;
}

type UnknownRecord = Record<string, unknown>;

const POLICY: Record<string, { capability_level: TemplateCapabilityLevel; readiness_requirements: TemplateReadinessRequirement[] }> = {
  "xiaohongshu-topic-generator": { capability_level: "production", readiness_requirements: [{ type: "input", key: "niche", required: true, label: "账号定位" }] },
  "pdf-summary": { capability_level: "production", readiness_requirements: [{ type: "file", key: "file", fileType: "pdf", required: true, label: "PDF 文件" }] },
  "short-video-script-analyzer": { capability_level: "production", readiness_requirements: [{ type: "input", key: "script_text", required: true, label: "短视频脚本" }] },
  "lead-form-auto-reply": { capability_level: "beta", readiness_requirements: [{ type: "webhook", key: "webhookSecret", required: true, label: "表单 Webhook" }] },
  "ecommerce-order-alert": { capability_level: "beta", readiness_requirements: [{ type: "webhook", key: "webhookSecret", required: true, label: "订单 Webhook" }] },
  "daily-news-briefing": { capability_level: "demo", readiness_requirements: [{ type: "input", key: "industry", required: true, label: "行业关键词" }] },
  "competitor-price-monitor": { capability_level: "demo", readiness_requirements: [{ type: "input", key: "product_urls", required: true, label: "竞品链接" }] },
  "feishu-message-summary": { capability_level: "demo", readiness_requirements: [{ type: "authorization", provider: "feishu", required: true, label: "飞书授权" }] }
};

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

export function getTemplateProductionPolicy(idOrSlug: string) {
  const value = String(idOrSlug || "").toLowerCase();
  for (const key of [value, value.replace(/^workflow-/, ""), value.replace(/_/g, "-")]) {
    if (POLICY[key]) return POLICY[key];
  }
  return { capability_level: "beta" as TemplateCapabilityLevel, readiness_requirements: [] as TemplateReadinessRequirement[] };
}

export function applyTemplateProductionPolicy<T extends TemplatePolicySource>(template: T): T & { capability_level: TemplateCapabilityLevel; readiness_requirements: TemplateReadinessRequirement[] } {
  const policy = getTemplateProductionPolicy(template.id || template.slug || "");
  const requirements = Array.isArray(template.readiness_requirements) && template.readiness_requirements.length > 0
    ? template.readiness_requirements
    : policy.readiness_requirements;
  return { ...template, capability_level: template.capability_level || policy.capability_level, readiness_requirements: requirements };
}

const present = (value: unknown): boolean => Array.isArray(value)
  ? value.length > 0
  : value && typeof value === "object"
    ? Object.keys(value).length > 0
    : value !== undefined && value !== null && String(value).trim() !== "";

export function evaluateWorkflowReadiness(template: TemplatePolicySource, values: UnknownRecord = {}): WorkflowReadinessResult {
  const normalized = applyTemplateProductionPolicy(template);
  if (normalized.capability_level === "coming_soon") {
    return { state: "unavailable", ready: false, missingRequirements: [], message: "该模板即将上线，当前不可部署。" };
  }

  const inputs: UnknownRecord = { ...asRecord(values.businessConfig), ...asRecord(values.template_inputs), ...asRecord(values.workflow_inputs), ...values };
  const authorizations = asRecord(values.authorizations);
  const credentials = asRecord(values.credentials);
  const dependencies = asRecord(values.dependencies);
  const missingRequirements = normalized.readiness_requirements.filter((item) => {
    if (item.required === false) return false;
    const key = item.key || item.provider || "";
    if (item.type === "authorization") return !present(authorizations[key]) && !present(credentials[key]);
    if (item.type === "credential") return !present(credentials[key]);
    if (item.type === "file") return !present(inputs[key || "file"]);
    if (item.type === "channel") return !present(values.channel_config) && !present(inputs[key || "channel"]);
    if (item.type === "webhook") return !present(values[key || "webhookSecret"]) && !present(values.webhook_config);
    if (item.type === "dependency") return !present(dependencies[key]);
    return !present(inputs[key]);
  });

  if (!missingRequirements.length) return { state: "ready", ready: true, missingRequirements, message: "工作流配置已就绪。" };
  const types = new Set(missingRequirements.map((item) => item.type));
  const state: WorkflowReadinessState = types.has("authorization") || types.has("credential")
    ? "authorization_required"
    : types.has("file") ? "file_required" : "config_required";
  return { state, ready: false, missingRequirements, message: `仍需完成：${missingRequirements.map((item) => item.label || item.key || item.provider || item.type).join("、")}` };
}

export function buildWorkflowReadinessPayload(readiness: WorkflowReadinessResult) {
  return {
    readiness: readiness.state,
    missing_fields: readiness.missingRequirements.map((item) => item.key || item.provider || item.type),
    missing_requirements: readiness.missingRequirements,
    setup_message: readiness.message
  };
}

export function assertTemplateDeployable<T extends TemplatePolicySource>(template: T) {
  const normalized = applyTemplateProductionPolicy(template);
  if (normalized.capability_level === "coming_soon") {
    const error = new Error("该模板即将上线，当前不可部署。") as Error & { code: string; statusCode: number };

    error.code = "TEMPLATE_COMING_SOON";
    error.statusCode = 409;
    throw error;
  }
  return normalized;
}

export function initialTaskStatus(readiness: WorkflowReadinessResult, requestedStatus = "queued"): string {
  return readiness.ready ? requestedStatus : "config_required";
}

export function selectInitialExecutionTasks(initialTasks: any[]): any[] {
  return initialTasks.slice(0, 1);
}
