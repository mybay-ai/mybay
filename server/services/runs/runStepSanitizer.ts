import * as crypto from "crypto";
import { truncateSafeText } from "./runSafeText";

type SafeToolCategory =
  | "search"
  | "browser"
  | "file"
  | "code"
  | "data"
  | "communication"
  | "other";

function getSafeToolCategory(incomingTool: string): SafeToolCategory {
  const t = incomingTool.toLowerCase();
  if (t.includes("search") || t.includes("google") || t.includes("bing")) return "search";
  if (t.includes("browser") || t.includes("web") || t.includes("page") || t.includes("scrape") || t.includes("visit") || t.includes("http")) return "browser";
  if (t.includes("file") || t.includes("read") || t.includes("write") || t.includes("save") || t.includes("upload") || t.includes("download") || t.includes("directory")) return "file";
  if (t.includes("code") || t.includes("exec") || t.includes("run") || t.includes("repl") || t.includes("python") || t.includes("interpreter") || t.includes("eval") || t.includes("bash") || t.includes("shell") || t.includes("cmd")) return "code";
  if (t.includes("db") || t.includes("sql") || t.includes("table") || t.includes("csv") || t.includes("json")) return "data";
  if (t.includes("mail") || t.includes("email") || t.includes("chat") || t.includes("slack") || t.includes("discord") || t.includes("telegram") || t.includes("feishu") || t.includes("send") || t.includes("message") || t.includes("communication")) return "communication";
  return "other";
}

type SafeRunStepStatus = "running" | "completed" | "failed";
type SafeRunStepType = "web_search" | "file_read" | "tool_call" | "model_reasoning" | "final";

export type SafeRunStep = {
  id: string;
  tool_name: string;
  stepType: SafeRunStepType;
  status: SafeRunStepStatus;
  title: string;
  safe_summary: string;
  startedAt?: number;
  completedAt?: number;
  metadata: Record<string, string | number | boolean>;
};

function normalizeStepStatus(value: unknown): SafeRunStepStatus {
  const incomingStatus = String(value || "").toLowerCase();
  if (["completed", "complete", "success", "succeeded", "done"].includes(incomingStatus)) return "completed";
  if (["failed", "error", "errored", "cancelled", "canceled"].includes(incomingStatus)) return "failed";
  return "running";
}

function getStepTypeFromCategory(category: SafeToolCategory, incomingTool: string): SafeRunStepType {
  const normalized = incomingTool.toLowerCase();
  if (category === "search" || normalized.includes("web_search")) return "web_search";
  if (category === "browser") return "web_search";
  if (category === "file") return "file_read";
  if (normalized.includes("reason") || normalized.includes("think") || normalized.includes("model")) return "model_reasoning";
  return "tool_call";
}

function getStepTitleI18nKey(stepType: SafeRunStepType, category: SafeToolCategory, status: SafeRunStepStatus): string {
  if (status === "failed") return "chatWorkspace.toolStepFailed";
  if (stepType === "final") return status === "completed" ? "chatWorkspace.toolStepFinalGenerated" : "chatWorkspace.toolStepFinalGenerating";
  if (stepType === "model_reasoning") return status === "completed" ? "chatWorkspace.toolStepReasoningCompleted" : "chatWorkspace.toolStepReasoningAnalyzing";

  const completed = status === "completed";
  switch (category) {
    case "search": return completed ? "chatWorkspace.toolStepSearchCompleted" : "chatWorkspace.toolStepSearchRunning";
    case "browser": return completed ? "chatWorkspace.toolStepBrowserCompleted" : "chatWorkspace.toolStepBrowserRunning";
    case "file": return completed ? "chatWorkspace.toolStepFileCompleted" : "chatWorkspace.toolStepFileRunning";
    case "code": return completed ? "chatWorkspace.toolStepCodeCompleted" : "chatWorkspace.toolStepCodeRunning";
    case "data": return completed ? "chatWorkspace.toolStepDataCompleted" : "chatWorkspace.toolStepDataRunning";
    case "communication": return completed ? "chatWorkspace.toolStepCommunicationCompleted" : "chatWorkspace.toolStepCommunicationRunning";
    default: return completed ? "chatWorkspace.toolStepCompleted" : "chatWorkspace.toolStepExecuting";
  }
}

function safeTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function firstSafeValue(...values: unknown[]): string {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      const joined = value.map((item) => firstSafeValue(item)).filter(Boolean).join(", ");
      if (joined) return joined;
      continue;
    }
    if (typeof value === "object") continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function pickNestedSafeValue(step: any, ...paths: string[]): string {
  for (const path of paths) {
    const parts = path.split(".");
    let current = step;
    for (const part of parts) {
      if (!current || typeof current !== "object") {
        current = undefined;
        break;
      }
      current = current[part];
    }
    const text = firstSafeValue(current);
    if (text) return text;
  }
  return "";
}

function buildSafeStepMetadata(step: any, category: SafeToolCategory): Record<string, string | number | boolean> {
  const metadata: Record<string, string | number | boolean> = { category };
  const rawCount = Number(step.count || step.result_count || step.results_count || step.items_count || step.output?.count || step.output?.total);
  if (Number.isFinite(rawCount) && rawCount >= 0 && rawCount <= 10000) metadata.count = rawCount;

  const source = truncateSafeText(firstSafeValue(step.source, step.provider, step.engine, step.site, step.domain, step.metadata?.source, step.metadata?.provider), 80);
  if (source) metadata.source = source;

  const query = truncateSafeText(firstSafeValue(
    step.query,
    step.search_query,
    step.keyword,
    step.keywords,
    step.metadata?.query,
    step.metadata?.search_query,
    pickNestedSafeValue(step, "input.query", "input.search_query", "args.query", "arguments.query", "params.query")
  ), 120);
  if (query && (category === "search" || category === "browser")) metadata.query = query;

  const url = truncateSafeText(firstSafeValue(
    step.url,
    step.href,
    step.link,
    step.page_url,
    step.metadata?.url,
    step.metadata?.href,
    step.metadata?.link,
    pickNestedSafeValue(step, "input.url", "args.url", "arguments.url", "params.url", "output.url", "result.url")
  ), 180);
  if (url && /^https?:\/\//i.test(url)) metadata.url = url;

  const pageTitle = truncateSafeText(firstSafeValue(step.page_title, step.title_text, step.metadata?.page_title, pickNestedSafeValue(step, "output.title", "result.title")), 120);
  if (pageTitle && pageTitle !== query) metadata.page_title = pageTitle;

  const filePath = truncateSafeText(firstSafeValue(
    step.file_path,
    step.file,
    step.path,
    step.filename,
    step.metadata?.file_path,
    step.metadata?.path,
    pickNestedSafeValue(step, "input.file_path", "input.path", "args.path", "arguments.path", "params.path", "output.path", "result.path")
  ), 180);
  if (filePath && !filePath.includes("..")) metadata.file_path = filePath;

  return metadata;
}

export function sanitizeStep(step: any): SafeRunStep {
  let stepId = String(step.id || step.step_id || "");
  if (!stepId || stepId.length > 96 || !/^[A-Za-z0-9_\-:.]+$/.test(stepId)) {
    stepId = `step-${crypto.randomUUID()}`;
  }

  const status = normalizeStepStatus(step.status);
  const incomingTool = String(step.name || step.tool_name || step.tool || step.action || "");
  const category = getSafeToolCategory(incomingTool);
  const rawStepType = String(step.stepType || step.step_type || "");
  const safeStepType: SafeRunStepType = ["web_search", "file_read", "tool_call", "model_reasoning", "final"].includes(rawStepType)
    ? rawStepType as SafeRunStepType
    : getStepTypeFromCategory(category, incomingTool);
  const title = truncateSafeText(step.title, 120) || getStepTitleI18nKey(safeStepType, category, status);
  const startedAt = safeTimestamp(step.startedAt || step.started_at || step.timestamp) || (status === "running" ? Date.now() : undefined);
  const completedAt = safeTimestamp(step.completedAt || step.completed_at) || (status !== "running" ? Date.now() : undefined);

  return {
    id: stepId,
    tool_name: category,
    stepType: safeStepType,
    status,
    title,
    safe_summary: title,
    startedAt,
    completedAt,
    metadata: buildSafeStepMetadata(step, category)
  };
}

