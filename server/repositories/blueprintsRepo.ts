import { dbAdapter } from "../db";
import { IndustryBlueprint, INDUSTRY_BLUEPRINTS } from "../templates/blueprints/blueprintsData";

function safeParseArray(val: any): any[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [val];
    } catch {
      return [val];
    }
  }
  return [];
}

export function parseDbBlueprint(row: any): IndustryBlueprint {
  return {
    id: row.id,
    slug: row.slug || row.id,
    name: row.name,
    description: row.description || "",
    category: row.category || "general",
    version: row.version || "1.0.0",
    recommended_skills: safeParseArray(row.recommended_skills),
    recommended_channels: safeParseArray(row.recommended_channels),
    referenced_workflow_template_ids: safeParseArray(row.referenced_workflow_template_ids),
    system_context_preview: row.system_context_preview || "",
    required_setup_items: safeParseArray(row.required_setup_items),
    post_deploy_guide: safeParseArray(row.post_deploy_guide),
    // Enhancement fields
    target_audience: row.target_audience || undefined,
    business_value: row.business_value || undefined,
    readiness_checklist: row.readiness_checklist ? safeParseArray(row.readiness_checklist) : undefined,
    next_actions: row.next_actions ? safeParseArray(row.next_actions) : undefined,
    translations: typeof row.translations === 'string' ? JSON.parse(row.translations) : (row.translations || undefined),
    limitations: row.limitations 
      ? (Array.isArray(row.limitations) 
          ? row.limitations 
          : (typeof row.limitations === 'string' && row.limitations.startsWith('[') 
              ? safeParseArray(row.limitations) 
              : row.limitations)) 
      : undefined,
  };
}

export const blueprintsRepo = {
  async listActive(): Promise<IndustryBlueprint[]> {
    try {
      const localBlueprints = await dbAdapter.listLocalBlueprints();
      const activeLocal = (localBlueprints || []).filter((row: any) => row.is_active !== false && row.is_active !== 0).map((row: any) => parseDbBlueprint(row));
      const merged = [...activeLocal, ...INDUSTRY_BLUEPRINTS.filter(b => !activeLocal.some((local: any) => local.id === b.id || local.slug === b.slug))];
      return merged.sort((a: any, b: any) => Number(a.sort_order || a.sortOrder || 0) - Number(b.sort_order || b.sortOrder || 0));
    } catch (err) {
      console.warn("[blueprintsRepo] Failed to list local blueprints, falling back to built-in INDUSTRY_BLUEPRINTS:", err);
      return [...INDUSTRY_BLUEPRINTS].sort((a: any, b: any) => Number(a.sort_order || a.sortOrder || 0) - Number(b.sort_order || b.sortOrder || 0));
    }
  },

  async findById(id: string): Promise<IndustryBlueprint | null> {
    try {
      const local = await dbAdapter.getLocalBlueprintById(id);
      if (local) return parseDbBlueprint(local);
    } catch (err) {
      // Fallback
    }
    return INDUSTRY_BLUEPRINTS.find(b => b.id === id || b.slug === id) || null;
  },

  async update(id: string, updates: any): Promise<IndustryBlueprint> {
    const payload: any = {};
    const textFields = ['name', 'description', 'category', 'version', 'system_context_preview', 'target_audience', 'business_value'];
    for (const f of textFields) {
      if (updates[f] !== undefined) payload[f] = updates[f];
    }
    const jsonFields = [
      'recommended_skills', 'recommended_channels', 'referenced_workflow_template_ids',
      'required_setup_items', 'post_deploy_guide', 'readiness_checklist',
      'next_actions', 'limitations', 'translations'
    ];
    for (const f of jsonFields) {
      if (updates[f] !== undefined) payload[f] = typeof updates[f] === 'string' ? JSON.parse(updates[f]) : updates[f];
    }
    payload.updated_at = new Date().toISOString();
    const saved = await dbAdapter.updateLocalBlueprint(id, payload);
    if (!saved) throw new Error("Blueprint not found");
    return parseDbBlueprint(saved);
  },

  async seedBlueprints() {
    for (const b of INDUSTRY_BLUEPRINTS) {
      await dbAdapter.upsertLocalBlueprint({
        id: b.id,
        slug: b.slug,
        name: b.name,
        description: b.description,
        category: b.category,
        version: b.version,
        is_active: true,
        recommended_skills: b.recommended_skills,
        recommended_channels: b.recommended_channels,
        referenced_workflow_template_ids: b.referenced_workflow_template_ids,
        system_context_preview: b.system_context_preview,
        required_setup_items: b.required_setup_items,
        post_deploy_guide: b.post_deploy_guide,
        target_audience: b.target_audience || null,
        business_value: b.business_value || null,
        readiness_checklist: b.readiness_checklist || [],
        next_actions: b.next_actions || [],
        limitations: Array.isArray(b.limitations) ? b.limitations : (typeof b.limitations === 'string' && b.limitations.trim() ? [b.limitations] : []),
        translations: b.translations || {},
        updated_at: new Date().toISOString()
      });
    }
  }
};
