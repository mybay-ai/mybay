export type TemplateFeatureEnvironment = Record<string, string | undefined>;

/**
 * Template workflows are an optional extension in MyBay Open Source.
 * They stay off unless an operator explicitly enables them.
 */
export function isTemplateWorkflowsEnabled(env: TemplateFeatureEnvironment = process.env): boolean {
  return String(env.TEMPLATE_CENTER_ENABLED || "").trim().toLowerCase() === "true";
}

export function isTemplateSchedulerEnabled(env: TemplateFeatureEnvironment = process.env): boolean {
  return isTemplateWorkflowsEnabled(env)
    && String(env.SCHEDULER_RUNNER_ENABLED || "").trim().toLowerCase() === "true";
}

export function hasTemplateDeploymentPayload(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return [
    "template_id",
    "template_slug",
    "template_snapshot",
    "template_inputs",
    "blueprint_id",
    "blueprint_slug",
    "blueprint_snapshot"
  ].some((key) => data[key] !== undefined && data[key] !== null);
}
