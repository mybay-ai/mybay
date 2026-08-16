import { dbAdapter } from "../db";
import { WorkflowTemplate } from "../templates/types";
import { SYSTEM_TEMPLATES } from "../templates/systemTemplates";
import { parseDbTemplate, serializeForDb } from "../templates/templateUtils";
import { applyTemplateProductionPolicy } from "../templates/productionPolicy";
import { skillPolicyRegistry } from "../../shared/skillPolicyRegistry";

export function templateUsesOnlyAvailableSkills(template: Pick<WorkflowTemplate, "default_skills">) {
  return (template.default_skills || []).every(
    (skillId) => skillPolicyRegistry[skillId]?.runtimeStatus !== "coming_soon",
  );
}

export type { WorkflowTemplate };
export { SYSTEM_TEMPLATES };

export const templatesRepo = {
  // Graceful list fetching with sorted order (local built-in templates)
  async listActive(): Promise<WorkflowTemplate[]> {
    try {
      const localTemplates = await dbAdapter.listLocalTemplates();
      const activeLocal = (localTemplates || [])
        .filter((row: any) => row.is_active !== false && row.is_active !== 0 && templateUsesOnlyAvailableSkills(parseDbTemplate(row)))
        .map((row: any) => applyTemplateProductionPolicy(parseDbTemplate(row)));
      const merged = [
        ...activeLocal,
        ...SYSTEM_TEMPLATES.filter(t => t.is_active !== false && templateUsesOnlyAvailableSkills(t) && !activeLocal.some((local: any) => local.id === t.id || local.slug === t.slug))
      ];
      return merged.map((item) => applyTemplateProductionPolicy(item)).sort((a: any, b: any) => Number(a.sort_order || a.sortOrder || 0) - Number(b.sort_order || b.sortOrder || 0));
    } catch (err) {
      console.warn("[templatesRepo] Failed to list local templates, falling back to built-in SYSTEM_TEMPLATES:", err);
      return SYSTEM_TEMPLATES.filter((item) => item.is_active !== false && templateUsesOnlyAvailableSkills(item)).map((item) => applyTemplateProductionPolicy(item)).sort((a: any, b: any) => Number(a.sort_order || a.sortOrder || 0) - Number(b.sort_order || b.sortOrder || 0));
    }
  },

  async findById(id: string): Promise<WorkflowTemplate | null> {
    try {
      const local = await dbAdapter.getLocalTemplateById(id);
      if (local) return applyTemplateProductionPolicy(parseDbTemplate(local));
    } catch (err) {
      // Fallback to built-in system templates
    }
    const builtIn = SYSTEM_TEMPLATES.find(t => t.id === id || t.slug === id);
    return builtIn ? applyTemplateProductionPolicy(builtIn) : null;
  },

  async create(templateData: any) {
    const payload = serializeForDb(templateData);
    const saved = await dbAdapter.upsertLocalTemplate({
      ...payload,
      id: payload.id || templateData.id || templateData.slug,
      created_at: payload.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    return parseDbTemplate(saved);
  },

  async update(id: string, updates: any) {
    const payload = serializeForDb(updates);
    const saved = await dbAdapter.updateLocalTemplate(id, payload);
    if (!saved) throw new Error("Template not found");
    return parseDbTemplate(saved);
  },

  async initAndSeed() {
    for (const template of SYSTEM_TEMPLATES) {
      await dbAdapter.upsertLocalTemplate(serializeForDb(template));
    }
  }
};
