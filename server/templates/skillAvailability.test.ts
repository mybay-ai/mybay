import { describe, expect, it } from "vitest";
import { skillPolicyRegistry } from "../../shared/skillPolicyRegistry";
import { SYSTEM_TEMPLATES } from "./systemTemplates";

describe("system template skill availability", () => {
  it("disables every template that references an unavailable runtime skill", () => {
    const unavailableTemplates = SYSTEM_TEMPLATES.filter((template) =>
      template.default_skills.some(
        (skillId) => skillPolicyRegistry[skillId]?.runtimeStatus === "coming_soon",
      ),
    );
    expect(unavailableTemplates.length).toBeGreaterThan(0);
    expect(unavailableTemplates.every(
      (template) => template.is_active === false && template.readiness === "coming_soon",
    )).toBe(true);
  });

  it("keeps templates selectable only when all default skills are runtime-available", () => {
    const selectable = SYSTEM_TEMPLATES.filter((template) => template.is_active !== false);
    expect(selectable.every((template) =>
      template.default_skills.every(
        (skillId) => skillPolicyRegistry[skillId]?.runtimeStatus !== "coming_soon",
      ),
    )).toBe(true);
  });
});
