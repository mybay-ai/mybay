export type TemplateLocale = "zh-CN" | "en";

export type TemplateTranslations = Partial<Record<TemplateLocale, Record<string, unknown>>>;

export function resolveTemplateLocale(value: unknown): TemplateLocale {
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = String(raw || "").trim().toLowerCase();
  return normalized.startsWith("en") ? "en" : "zh-CN";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMergeLocalized(base: unknown, overlay: unknown): unknown {
  if (Array.isArray(overlay)) {
    const baseItems = Array.isArray(base) ? base : [];
    return overlay.map((item, index) => {
      if (isPlainObject(item) && typeof item.key === "string") {
        const matched = baseItems.find(candidate => isPlainObject(candidate) && candidate.key === item.key);
        return deepMergeLocalized(matched, item);
      }
      return deepMergeLocalized(baseItems[index], item);
    });
  }
  if (!isPlainObject(overlay)) return overlay;
  const result: Record<string, unknown> = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(overlay)) {
    result[key] = isPlainObject(value) ? deepMergeLocalized(result[key], value) : deepMergeLocalized(undefined, value);
  }
  return result;
}

export function localizeTemplateRecord<T extends Record<string, any>>(record: T, locale: TemplateLocale): T {
  if (!record) return record;
  const translations = record.translations as TemplateTranslations | undefined;
  const overlay = translations?.[locale];
  const localized = overlay ? deepMergeLocalized(record, overlay) as T : { ...record };
  delete (localized as any).translations;
  return localized;
}

export function localizeTemplateList<T extends Record<string, any>>(records: T[], locale: TemplateLocale): T[] {
  return records.map(record => localizeTemplateRecord(record, locale));
}