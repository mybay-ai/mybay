import { TemplateItem } from "./types";

/**
 * Parses lines from standard line arrays or serialized JSON formats
 */
export function parseLines(fieldVal: any): string[] {
  if (!fieldVal) return [];
  if (Array.isArray(fieldVal)) return fieldVal.filter(Boolean);
  if (typeof fieldVal === "string") {
    try {
      const parsed = JSON.parse(fieldVal);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch {
      return fieldVal.split("\n").map(l => l.trim()).filter(Boolean);
    }
  }
  return [];
}

/**
 * Transforms an array field into line-separated values suited for a textarea form field
 */
export function parseArrayField(fieldVal: any): string {
  if (!fieldVal) return "";
  if (Array.isArray(fieldVal)) {
    return fieldVal.join("\n");
  }
  if (typeof fieldVal === "string") {
    try {
      const parsed = JSON.parse(fieldVal);
      if (Array.isArray(parsed)) return parsed.join("\n");
    } catch {
      return fieldVal;
    }
  }
  return "";
}

/**
 * Normalizes business_value array or string into display text
 */
export function getBusinessValueString(val: any): string {
  if (!val) return "";
  if (Array.isArray(val)) {
    return val.filter(Boolean).join("\n");
  }
  return String(val);
}

/**
 * Validates which template items are filled dynamically from DB vs static fallbacks
 */
export function checkFieldsStatus(item: TemplateItem) {
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
        return [];
      }
    }
    return [];
  })();

  const emptyFields = [];
  const missingLabels: string[] = [];

  if (!item.target_audience?.trim()) {
    emptyFields.push("target_audience");
    missingLabels.push("目标受众");
  }
  
  const isBusinessValueValid = (() => {
    if (!item.business_value) return false;
    if (typeof item.business_value === "string") {
      const trimmed = item.business_value.trim();
      if (!trimmed) return false;
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        return parseLines(trimmed).length > 0;
      }
      return true;
    }
    if (Array.isArray(item.business_value)) {
      return item.business_value.some(val => typeof val === "string" && val.trim().length > 0);
    }
    return false;
  })();
  
  if (!isBusinessValueValid) {
    emptyFields.push("business_value");
    missingLabels.push("商业价值");
  }
  
  if (parseLines(item.readiness_checklist).length === 0) {
    emptyFields.push("readiness_checklist");
    missingLabels.push("启动前准备");
  }
  if (parseLines(item.post_deploy_guide).length === 0 && parseLines(item.setup_steps).length === 0) {
    emptyFields.push("post_deploy_guide");
    missingLabels.push("部署后指南");
  }
  if (parseLines(item.limitations).length === 0) {
    emptyFields.push("limitations");
    missingLabels.push("使用限制");
  }
  if (nextActions.length === 0) {
    emptyFields.push("next_actions");
    missingLabels.push("下一步动作");
  }

  const missingCount = emptyFields.length;
  
  if (missingCount === 0) {
    return {
      status: "complete",
      text: "当前内容来源：数据库已发布内容",
      color: "text-emerald-700 bg-emerald-50 border-emerald-100",
      missingLabels: []
    };
  } else {
    return {
      status: "partial",
      text: "当前部分内容仍使用静态兜底，建议在模板管理台补齐",
      color: "text-amber-700 bg-amber-50/80 border-amber-100",
      missingLabels
    };
  }
}
