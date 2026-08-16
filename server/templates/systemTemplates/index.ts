import { dailyNewsBriefing } from "./dailyNewsBriefing";
import { competitorPriceMonitor } from "./competitorPriceMonitor";
import { feishuMessageSummary } from "./feishuMessageSummary";
import { pdfSummary } from "./pdfSummary";
import { leadFormAutoReply } from "./leadFormAutoReply";
import { ecommerceOrderAlert } from "./ecommerceOrderAlert";
import { xiaohongshuTopicGenerator } from "./xiaohongshuTopicGenerator";
import { shortVideoScriptAnalyzer } from "./shortVideoScriptAnalyzer";
import { WorkflowTemplate } from "../types";
import { WORKFLOW_EN_TRANSLATIONS } from "./workflowTranslations";
import { skillPolicyRegistry } from "../../../shared/skillPolicyRegistry";

export const SYSTEM_TEMPLATES: WorkflowTemplate[] = [
  dailyNewsBriefing,
  competitorPriceMonitor,
  feishuMessageSummary,
  pdfSummary,
  leadFormAutoReply,
  ecommerceOrderAlert,
  xiaohongshuTopicGenerator,
  shortVideoScriptAnalyzer
];

for (const template of SYSTEM_TEMPLATES) {
  const unavailableSkills = template.default_skills.filter(
    (skillId) => skillPolicyRegistry[skillId]?.runtimeStatus === "coming_soon",
  );
  if (unavailableSkills.length > 0) {
    template.is_active = false;
    template.readiness = "coming_soon";
  }
  const english = WORKFLOW_EN_TRANSLATIONS[template.id];
  if (!english) continue;
  template.translations = {
    ...(template.translations || {}),
    en: english
  };
}
