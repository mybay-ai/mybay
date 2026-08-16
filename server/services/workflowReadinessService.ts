import fs from "fs";
import path from "path";
import { dbAdapter } from "../db";
import { scheduledJobsRepo } from "../repositories/scheduledJobsRepo";
import { tasksRepo } from "../repositories/tasksRepo";
import { templatesRepo } from "../repositories/templatesRepo";
import { applyTemplateProductionPolicy, evaluateWorkflowReadiness, type TemplatePolicySource } from "../templates/productionPolicy";

type UnknownRecord = Record<string, unknown>;
export interface BoundFileEvidence { name: string; mimeType?: string; path?: string; }

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function parseConfig(value: unknown): UnknownRecord {
  if (typeof value !== "string") return asRecord(value);
  try { return asRecord(JSON.parse(value || "{}")); } catch { return {}; }
}

function hasValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function firstValue(...values: unknown[]): unknown { return values.find(hasValue); }
function isPdf(file: BoundFileEvidence): boolean { return file.mimeType === "application/pdf" || file.name.toLowerCase().endsWith(".pdf") || Boolean(file.path?.toLowerCase().endsWith(".pdf")); }

export function discoverInstancePdfFiles(instanceId: string, instanceValue: unknown): BoundFileEvidence[] {
  const instance = asRecord(instanceValue);
  const roots = new Set<string>([path.resolve(process.cwd(), "data", "instances", instanceId, "uploads")]);
  if (typeof instance.data_volume_path === "string" && instance.data_volume_path.trim()) roots.add(path.resolve(instance.data_volume_path, "uploads"));
  const files: BoundFileEvidence[] = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) files.push({ name: entry.name, mimeType: "application/pdf", path: path.join(root, entry.name) });
    }
  }
  return files;
}

export function buildWorkflowReadinessContext(configValue: unknown, boundFiles: BoundFileEvidence[] = []): UnknownRecord {
  const config = asRecord(configValue);
  const templateInputs = asRecord(config.template_inputs);
  const workflowInputs = asRecord(config.workflow_inputs);
  const businessConfig = asRecord(config.businessConfig);
  const pdf = boundFiles.find(isPdf);
  const feishuConfigured = hasValue(config.feishuAppId) && hasValue(config.feishuAppSecret);
  const normalizedInputs: UnknownRecord = {
    ...templateInputs,
    ...workflowInputs,
    niche: firstValue(templateInputs.niche, workflowInputs.niche, businessConfig.niche, businessConfig.account_positioning, businessConfig.accountPositioning, config.niche),
    script_text: firstValue(templateInputs.script_text, workflowInputs.script_text, businessConfig.script_text, businessConfig.scriptText, config.script_text),
    industry: firstValue(templateInputs.industry, workflowInputs.industry, businessConfig.industry, businessConfig.industry_keyword, businessConfig.industryKeyword, config.industry),
    product_urls: firstValue(templateInputs.product_urls, workflowInputs.product_urls, businessConfig.product_urls, businessConfig.competitor_urls, businessConfig.competitorUrls, businessConfig.monitorSkus, config.product_urls),
    file: pdf ? { name: pdf.name, mimeType: pdf.mimeType, path: pdf.path } : firstValue(templateInputs.file, workflowInputs.file)
  };
  return {
    ...config,
    businessConfig,
    template_inputs: normalizedInputs,
    workflow_inputs: normalizedInputs,
    webhookSecret: firstValue(config.webhookSecret, config.webhook_secret, businessConfig.webhookSecret, businessConfig.webhook_secret),
    channel_config: firstValue(config.channel_config, config.channelConfig, config.channel),
    authorizations: { ...asRecord(config.authorizations), ...(feishuConfigured ? { feishu: { configured: true } } : {}) },
    credentials: asRecord(config.credentials)
  };
}

export async function evaluateInstanceWorkflowReadiness(input: { instanceId: string; templateId: string; instanceOverride?: unknown; configOverride?: unknown; executionPayload?: unknown; fileEvidence?: BoundFileEvidence[]; template?: TemplatePolicySource; }) {
  const rawInstance = input.instanceOverride ?? await dbAdapter.getInstanceById(input.instanceId);
  if (!rawInstance) throw new Error(`无法解析工作流状态：实例不存在 ${input.instanceId}`);
  const instance = asRecord(rawInstance);
  const config = { ...parseConfig(instance.config_json), ...asRecord(input.configOverride), ...asRecord(input.executionPayload) };
  const files = [...discoverInstancePdfFiles(input.instanceId, instance), ...(input.fileEvidence || [])];
  const context = buildWorkflowReadinessContext(config, files);
  const template = input.template || await templatesRepo.findById(input.templateId) || { id: input.templateId };
  return { context, readiness: evaluateWorkflowReadiness(applyTemplateProductionPolicy(template), context) };
}

function isTerminalTask(status: unknown): boolean {
  return ["success", "completed", "processing", "failed", "failed-terminal", "cancelled", "canceled"].includes(String(status || "").toLowerCase());
}

export async function refreshInstanceWorkflowReadiness(instanceId: string, configOverride?: unknown) {
  const instance = await dbAdapter.getInstanceById(instanceId);
  if (!instance) throw new Error(`无法刷新工作流状态：实例不存在 ${instanceId}`);
  const [tasks, jobs] = await Promise.all([tasksRepo.listByInstance(instanceId), scheduledJobsRepo.listByInstance(instanceId)]);
  const templateIds = new Set<string>();
  for (const item of [...tasks, ...jobs]) {
    const key = String(item.template_id || item.input_payload?.template_id || item.input_payload?.template_slug || "").toLowerCase();
    if (key) templateIds.add(key);
  }
  const results = [];
  for (const templateId of templateIds) {
    const { readiness } = await evaluateInstanceWorkflowReadiness({ instanceId, instanceOverride: instance, configOverride, templateId });
    const payload = {
      readiness: readiness.state,
      missing_fields: readiness.missingRequirements.map((item) => item.key || item.provider || item.type),
      missing_requirements: readiness.missingRequirements,
      setup_message: readiness.message
    };
    for (const task of tasks.filter((item) => String(item.template_id || "").toLowerCase() === templateId && !isTerminalTask(item.status))) {
      if (task.id) await tasksRepo.update(task.id, { status: readiness.ready ? "queued" : "config_required", error: readiness.ready ? null : readiness.message, input_payload: { ...(task.input_payload || {}), workflow_readiness: payload } });
    }
    for (const job of jobs.filter((item) => String(item.template_id || item.input_payload?.template_id || item.input_payload?.template_slug || "").toLowerCase() === templateId)) {
      if (job.id) await scheduledJobsRepo.update(job.id, { is_active: readiness.ready, next_run_at: readiness.ready && !job.next_run_at ? new Date(Date.now() + 120_000).toISOString() : job.next_run_at, input_payload: { ...(job.input_payload || {}), workflow_readiness: payload } });
    }
    results.push({ templateId, readiness: readiness.state, ready: readiness.ready });
  }
  return results;
}
