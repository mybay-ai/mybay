import React from "react";
import { useTranslation } from "react-i18next";
import { Target, User, CheckCircle2 } from "lucide-react";

interface DetailAudienceValueSectionProps {
  id: string;
  title: string;
  targetAudience: string;
  businessImpact?: string[]; // for blueprints
  businessValue?: string; // for workflows
  automationResult?: string; // for workflows
  themeColor: "blue" | "amber";
}

export function DetailAudienceValueSection({
  id,
  title,
  targetAudience,
  businessImpact,
  businessValue,
  automationResult,
  themeColor,
}: DetailAudienceValueSectionProps) {
  const { t } = useTranslation("dashboard");
  const iconColorClass = themeColor === "blue" ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400";
  const userBgClass = themeColor === "blue" 
    ? "bg-blue-50/30 border-blue-100/30 dark:bg-blue-950/20 dark:border-blue-900/30" 
    : "bg-amber-500/5 border-amber-500/10 dark:bg-amber-950/15 dark:border-amber-900/20";
  const userIconColorClass = themeColor === "blue" ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400";
  const userTitleColorClass = themeColor === "blue" ? "text-blue-800 dark:text-blue-400" : "text-amber-800 dark:text-amber-400";
  const userTitleText = themeColor === "blue" 
    ? t("template_center.modal.audience_title_blue", "适合哪些团队 / 用户") 
    : t("template_center.modal.audience_title_amber", "推荐提效团队");

  return (
    <div id={id} className="bg-surface rounded-2xl p-6 border border-slate-200/60 dark:border-slate-800 shadow-sm space-y-4 scroll-mt-4 text-left">
      <div className="flex items-center gap-2 text-content border-b border-outline pb-3">
        <Target className={`w-5 h-5 ${iconColorClass}`} />
        <h4 className="font-bold text-base text-content">{title}</h4>
      </div>
      
      <div className={`${themeColor === "blue" ? "space-y-3.5" : "space-y-4"} text-sm leading-relaxed text-slate-600 dark:text-slate-300`}>
        <div className={`flex items-start gap-3 p-3 rounded-xl border ${userBgClass}`}>
          <User className={`w-4.5 h-4.5 ${userIconColorClass} mt-1 sm:mt-0.5 shrink-0`} />
          <div>
            <span className={`${userTitleColorClass} text-xs font-bold block uppercase tracking-wide`}>
              {userTitleText}
            </span>
            <span className="text-slate-800 dark:text-slate-200 font-semibold">{targetAudience}</span>
          </div>
        </div>

        {/* Blueprint-specific business impacts */}
        {themeColor === "blue" && businessImpact && businessImpact.length > 0 && (
          <div className="space-y-2.5 pt-1.5">
            <span className="text-content-muted font-semibold text-xs block">
              {t("template_center.modal.core_results_label", "部署后你将获得的核心结果：")}
            </span>
            <ul className="space-y-2.5">
              {businessImpact.map((impact, idx) => (
                <li key={idx} className="flex items-start gap-2 text-content-secondary">
                  <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500 shrink-0 mt-0.5" />
                  <span className="leading-relaxed font-normal">{impact}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Workflow-specific business value */}
        {themeColor === "amber" && businessValue && (
          <div className="flex items-start gap-3 bg-emerald-500/5 dark:bg-emerald-950/15 p-3 rounded-xl border border-emerald-500/10 dark:border-emerald-900/20">
            <CheckCircle2 className="w-4.5 h-4.5 text-emerald-600 dark:text-emerald-400 mt-1 shrink-0" />
            <div>
              <span className="text-xs text-emerald-800 dark:text-emerald-400 font-bold block uppercase tracking-wide">
                {t("template_center.modal.business_value_title", "核心商业价值")}
              </span>
              <span className="text-slate-800 dark:text-slate-200 font-semibold">{businessValue}</span>
            </div>
          </div>
        )}

        {/* Workflow-specific automation result */}
        {themeColor === "amber" && automationResult && (
          <div className="space-y-1.5">
            <span className="text-content-muted font-semibold text-xs block uppercase">
              {t("template_center.modal.automation_result_title", "预期自动化运行结果：")}
            </span>
            <p className="text-content-secondary font-medium bg-slate-50 dark:bg-slate-950/40 p-3.5 rounded-xl border border-outline/80 leading-relaxed text-xs">
              {automationResult}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

