import { describe, expect, it } from "vitest";
import { localizeTemplateRecord, resolveTemplateLocale } from "./localization";
import { INDUSTRY_BLUEPRINTS } from "./blueprints/blueprintsData";
import { SYSTEM_TEMPLATES } from "./systemTemplates";

describe("template localization", () => {
  it("resolves English and Chinese locale variants", () => {
    expect(resolveTemplateLocale("en-US,en;q=0.9")).toBe("en");
    expect(resolveTemplateLocale("zh-CN,zh;q=0.9")).toBe("zh-CN");
    expect(resolveTemplateLocale(undefined)).toBe("zh-CN");
  });

  it("deep-merges translated fields without mutating source data", () => {
    const source = {
      id: "demo",
      name: "中文名称",
      required_inputs: [{ key: "topic", label: "主题" }],
      translations: {
        en: {
          name: "English name",
          required_inputs: [{ key: "topic", label: "Topic" }]
        }
      }
    };
    const localized = localizeTemplateRecord(source, "en");
    expect(localized.name).toBe("English name");
    expect(localized.required_inputs[0].label).toBe("Topic");
    expect(localized.required_inputs[0].key).toBe("topic");
    expect((localized as any).translations).toBeUndefined();
    expect(source.name).toBe("中文名称");
  });
  it("localizes every built-in workflow and blueprint", () => {
    expect(SYSTEM_TEMPLATES).toHaveLength(8);
    expect(INDUSTRY_BLUEPRINTS).toHaveLength(4);

    for (const item of [...SYSTEM_TEMPLATES, ...INDUSTRY_BLUEPRINTS]) {
      const localized = localizeTemplateRecord(item, "en");
      expect(localized.name).toMatch(/[A-Za-z]/);
      expect(localized.name).not.toMatch(/[\u4e00-\u9fff]/);
      expect((localized as any).translations).toBeUndefined();
    }
  });
});
