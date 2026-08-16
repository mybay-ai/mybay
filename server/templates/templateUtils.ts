import { WorkflowTemplate } from "./types";

export function parseDbTemplate(row: any): WorkflowTemplate {
  if (!row) return row;
  return {
    id: row.id,
    slug: row.slug || row.id,
    name: row.name,
    description: row.description || "",
    category: row.category || "general",
    icon: row.icon || "Sparkles",
    use_case: row.use_case || "",
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags || []),
    default_provider: row.default_provider || "google",
    default_model: row.default_model || "gemini-2.5-flash",
    default_channel: row.default_channel || "web",
    default_prompt: row.default_prompt || "",
    default_skills: typeof row.default_skills === 'string' ? JSON.parse(row.default_skills) : (row.default_skills || []),
    default_config: typeof row.default_config === 'string' ? JSON.parse(row.default_config) : (row.default_config || {}),
    required_inputs: typeof row.required_inputs === 'string' ? JSON.parse(row.required_inputs) : (row.required_inputs || []),
    supported_triggers: typeof row.supported_triggers === 'string' ? JSON.parse(row.supported_triggers) : (row.supported_triggers || []),
    default_trigger: typeof row.default_trigger === 'string' ? JSON.parse(row.default_trigger) : (row.default_trigger || {}),
    default_output: typeof row.default_output === 'string' ? JSON.parse(row.default_output) : (row.default_output || {}),
    required_permissions: typeof row.required_permissions === 'string' ? JSON.parse(row.required_permissions) : (row.required_permissions || []),
    setup_steps: typeof row.setup_steps === 'string' ? JSON.parse(row.setup_steps) : (row.setup_steps || []),
    initial_tasks: typeof row.initial_tasks === 'string' ? JSON.parse(row.initial_tasks) : (row.initial_tasks || []),
    risk_level: row.risk_level || "low",
    is_system: row.is_system !== undefined ? !!row.is_system : true,
    is_active: row.is_active !== undefined ? !!row.is_active : true,
    sort_order: row.sort_order || 0,
    readiness: row.readiness || undefined,
    target_audience: row.target_audience || undefined,
    readiness_checklist: typeof row.readiness_checklist === 'string' ? JSON.parse(row.readiness_checklist) : (row.readiness_checklist || undefined),
    post_deploy_guide: typeof row.post_deploy_guide === 'string' ? JSON.parse(row.post_deploy_guide) : (row.post_deploy_guide || undefined),
    next_actions: typeof row.next_actions === 'string' ? JSON.parse(row.next_actions) : (row.next_actions || undefined),
    limitations: typeof row.limitations === 'string' ? JSON.parse(row.limitations) : (row.limitations || undefined),
    automation_result: row.automation_result || undefined,
    business_value: row.business_value || undefined,
    capability_level: row.capability_level || undefined,
    readiness_requirements: typeof row.readiness_requirements === 'string' ? JSON.parse(row.readiness_requirements) : (row.readiness_requirements || undefined),
    translations: typeof row.translations === 'string' ? JSON.parse(row.translations) : (row.translations || undefined)
  };
}

export function serializeForDb(t: any): any {
  const serialized: any = {};
  const stringFields = [
    'id', 'slug', 'name', 'description', 'category', 'icon', 'use_case',
    'default_provider', 'default_model', 'default_channel', 'default_prompt',
    'risk_level', 'is_system', 'is_active', 'sort_order', 'readiness', 'capability_level',
    'target_audience', 'automation_result', 'business_value'
  ];
  
  for (const f of stringFields) {
    if (t[f] !== undefined) {
      serialized[f] = t[f];
    }
  }

  const jsonFields = [
    'tags', 'default_skills', 'default_config', 'required_inputs',
    'supported_triggers', 'default_trigger', 'default_output',
    'required_permissions', 'setup_steps', 'initial_tasks',
    'readiness_checklist', 'post_deploy_guide', 'next_actions', 'limitations', 'translations', 'readiness_requirements'
  ];

  for (const jf of jsonFields) {
    if (t[jf] !== undefined) {
      serialized[jf] = typeof t[jf] === 'string' ? JSON.parse(t[jf]) : t[jf];
    }
  }

  serialized.updated_at = new Date().toISOString();
  return serialized;
}
