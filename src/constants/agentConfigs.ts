/**
 * ----------------------------------------------------------------------------
 * DEPRECATED / LEGACY MODEL CONFIGURATIONS REMOVED
 * ----------------------------------------------------------------------------
 * 
 * 【警告】此文件不再承担模型供应商 (Provider)、模型列表 (Models) 和 Base URL 的配置职责。
 * 
 * 全项目唯一合法的、具有权威性的单配置源已被统一收口至：
 * ===> shared/providerRegistry.ts <===
 * 
 * 为了防止双配置源漂移和数据冲突，历史遗留的 `providerModels` 和 `defaultBaseUrls` 已被彻底清理。
 * 如果未来需要添加、删除或修改模型以及 LLM Provider 配置，请直接修改 `shared/providerRegistry.ts`。
 */

import { skillPolicyRegistry } from "../../shared/skillPolicyRegistry";

export interface SkillMetaItem {
  id: string;
  name: string;
  desc: string;
  requiresKey?: string;
  label?: string;
  placeholder?: string;
}

/**
 * 智能体插件能力元数据映射，从共享的 skillPolicyRegistry 动态生成。
 * 目前保留此项作为可选的前端辅助结构，底层核心策略定义位于 shared/skillPolicyRegistry.ts。
 */
export const skillsMeta: SkillMetaItem[] = Object.values(skillPolicyRegistry).map(p => ({
  id: p.id,
  name: p.name,
  desc: p.desc,
  requiresKey: p.requiresKey,
  label: p.label,
  placeholder: p.placeholder
}));

