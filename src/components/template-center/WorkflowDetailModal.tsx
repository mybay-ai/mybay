import { 
  X, ArrowRight, Terminal, Zap, Clock, CheckCircle2, Sparkles
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { WorkflowTemplate } from "./types";
import { STATIC_WORKFLOW_GUIDES } from "./constants";
import { safeParseArray, getRiskLevelTranslationKey, resolveWorkflowMarketingFallback, getLocalizedWorkflow, formatTemplatePlugin, formatTemplateChannel } from "./utils";
import { DetailSourceBadge } from "./DetailSourceBadge";
import { DetailLimitationsSection } from "./DetailLimitationsSection";
import { DetailGuideStepsSection } from "./DetailGuideStepsSection";
import { DetailSandboxGuarantee } from "./DetailSandboxGuarantee";
import { DetailAudienceValueSection } from "./DetailAudienceValueSection";
import { DetailPromptSection } from "./DetailPromptSection";

interface WorkflowDetailModalProps {
  workflow: WorkflowTemplate;
  onClose: () => void;
  onUseWorkflow: (id: string) => void;
  isRecommended?: boolean;
}

export function WorkflowDetailModal({ workflow: rawWorkflow, onClose, onUseWorkflow, isRecommended }: WorkflowDetailModalProps) {
  const { t, i18n } = useTranslation("dashboard");
  const workflow = getLocalizedWorkflow(rawWorkflow, t);
  const wfMarketingDetail = resolveWorkflowMarketingFallback(workflow, t);

  const wfTargetAudience = workflow.target_audience || wfMarketingDetail.targetAudience;
  const wfAutomationResult = workflow.automation_result || wfMarketingDetail.automationResult;

  const wfReadinessChecklist = (() => {
    const parsedDb = safeParseArray(workflow.readiness_checklist);
    if (parsedDb.length > 0) {
      return parsedDb;
    }
    return wfMarketingDetail.keyRequirements || [];
  })();

  const wfGuideSteps = (() => {
    const parsedPostDeploy = safeParseArray(workflow.post_deploy_guide);
    if (parsedPostDeploy.length > 0) {
      return parsedPostDeploy;
    }
    const parsedSetup = safeParseArray(workflow.setup_steps);
    if (parsedSetup.length > 0) {
      return parsedSetup;
    }
    return STATIC_WORKFLOW_GUIDES[workflow.id] || [];
  })();

  const wfLimitations = workflow.limitations || wfMarketingDetail.limitations;

  const wfBusinessValue = (() => {
    const val = workflow.business_value || wfMarketingDetail.business_value;
    if (!val) return null;
    if (Array.isArray(val)) {
      return val.join("；");
    }
    return val;
  })();

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/75 md:backdrop-blur-md flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 z-0 touch-none" onClick={onClose} />
      <div className="bg-surface rounded-3xl w-full max-w-3xl overflow-hidden shadow-2xl relative z-10 animate-in zoom-in-95 duration-200 flex flex-col max-h-[92vh] sm:max-h-[90vh] min-h-0 text-left border border-outline">
        
        {/* Slate Header Banner */}
        <header className="bg-slate-900 text-white p-4 sm:p-6 md:p-8 relative overflow-hidden shrink-0">
          <div className="absolute top-0 right-0 w-80 h-80 bg-slate-800 rounded-full md:blur-3xl -z-0 pointer-events-none" />
          <div className="relative z-10 flex justify-between items-start">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] sm:text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/20">
                  <Terminal className="w-3.5 h-3.5" />
                  {t("template_center.modal.type_workflow")}
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20 uppercase">
                  {t("template_center.risk_label")}: {t(getRiskLevelTranslationKey(workflow.risk_level))}
                </span>
                <DetailSourceBadge item={workflow} />
                {isRecommended && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] sm:text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    <Sparkles className="w-3 h-3 text-emerald-400" />
                    {t("template_center.recommendation_badge")}
                  </span>
                )}
              </div>
              <h3 className="text-lg sm:text-xl md:text-2xl font-black tracking-tight text-white">{workflow.name}</h3>
              <p className="text-xs sm:text-sm text-slate-300 max-w-2xl mt-1">{workflow.description}</p>
            </div>
            
            <button 
              type="button" 
              className="p-1.5 rounded-lg bg-slate-800/80 text-content-muted hover:text-white hover:bg-slate-800 transition-colors duration-150 shrink-0 ml-4"
              onClick={onClose}
              aria-label={t("template_center.modal.aria_close") || "Close"}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Anchor Navigation Bar */}
        <div className="bg-control-hover/90 px-4 sm:px-6 py-2 border-b border-slate-200/80 dark:border-slate-700/80 flex items-center overflow-x-auto whitespace-nowrap gap-2 text-xs shrink-0 font-medium z-10 shadow-sm scrollbar-none">
          <span className="text-content-muted font-bold self-center mr-1 shrink-0">{t("template_center.modal.nav_label")}</span>
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById("wf-section-value");
              if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }}
            className="shrink-0 px-2.5 py-1 rounded-lg bg-surface hover:bg-amber-50 dark:hover:bg-slate-800 hover:text-amber-700 dark:hover:text-amber-300 border border-outline text-content-secondary shadow-sm transition-all duration-150 font-bold cursor-pointer hover:border-amber-400 dark:hover:border-amber-500/30"
          >
            {t("template_center.modal.tab_value")}
          </button>
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById("wf-section-prep");
              if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }}
            className="shrink-0 px-2.5 py-1 rounded-lg bg-surface hover:bg-amber-50 dark:hover:bg-slate-800 hover:text-amber-700 dark:hover:text-amber-300 border border-outline text-content-secondary shadow-sm transition-all duration-150 font-bold cursor-pointer hover:border-amber-400 dark:hover:border-amber-500/30"
          >
            {t("template_center.modal.tab_prep")}
          </button>
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById("wf-section-context");
              if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }}
            className="shrink-0 px-2.5 py-1 rounded-lg bg-surface hover:bg-amber-50 dark:hover:bg-slate-800 hover:text-amber-700 dark:hover:text-amber-300 border border-outline text-content-secondary shadow-sm transition-all duration-150 font-bold cursor-pointer hover:border-amber-400 dark:hover:border-amber-500/30"
          >
            {t("template_center.modal.tab_context")}
          </button>
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById("wf-section-guide");
              if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }}
            className="shrink-0 px-2.5 py-1 rounded-lg bg-surface hover:bg-amber-50 dark:hover:bg-slate-800 hover:text-amber-700 dark:hover:text-amber-300 border border-outline text-content-secondary shadow-sm transition-all duration-150 font-bold cursor-pointer hover:border-amber-400 dark:hover:border-amber-500/30"
          >
            {t("template_center.modal.tab_guide")}
          </button>
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById("wf-section-limits");
              if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }}
            className="shrink-0 px-2.5 py-1 rounded-lg bg-surface hover:bg-amber-50 dark:hover:bg-slate-800 hover:text-amber-700 dark:hover:text-amber-300 border border-outline text-content-secondary shadow-sm transition-all duration-150 font-bold cursor-pointer hover:border-amber-400 dark:hover:border-amber-500/30"
          >
            {t("template_center.modal.tab_limits")}
          </button>
        </div>

        {/* Body Content - Dual Column */}
        <div id="workflow-modal-body" className="p-4 sm:p-6 md:p-8 overflow-y-auto bg-slate-50/50 dark:bg-slate-950/40 flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 min-h-0 scroll-smooth [webkit-overflow-scrolling:touch] overscroll-contain touch-pan-y">
          
          {/* Left Column (2/3 width) - Focus and Prompt */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Positioning & Intended Impact */}
            <DetailAudienceValueSection
              id="wf-section-value"
              title={t("template_center.modal.title_value")}
              targetAudience={wfTargetAudience}
              businessValue={wfBusinessValue || undefined}
              automationResult={wfAutomationResult}
              themeColor="amber"
            />

            {/* Prompt Preview */}
            <DetailPromptSection
              id="wf-section-context"
              title={t("template_center.modal.title_context")}
              prompt={workflow.default_prompt}
              themeColor="amber"
            />

            {/* Dynamic Post-Deploy Guide Steps for Workflows */}
            <DetailGuideStepsSection
              id="wf-section-guide"
              title={t("template_center.modal.title_guide")}
              steps={wfGuideSteps}
              themeColor="amber"
            />

            {/* Section 3: Limitations & Notes */}
            <DetailLimitationsSection
              id="wf-section-limits"
              title={t("template_center.modal.title_limits")}
              limitations={wfLimitations}
            />

          </div>

          {/* Right Column (1/3 width) - Prerequisites & Trigger Mode */}
          <div id="wf-section-prep" className="space-y-6 scroll-mt-4">
            
            {/* Preparation Box */}
            <div className="bg-slate-900 text-white rounded-2xl p-6 space-y-4 shadow-md border border-slate-800">
              <div className="flex items-center gap-2 text-amber-400 border-b border-slate-800 pb-2.5">
                <Zap className="w-4.5 h-4.5" />
                <h4 className="font-bold text-sm">{t("template_center.modal.title_prep")}</h4>
              </div>
              
              <div className="space-y-3 text-xs leading-relaxed text-slate-300">
                <div className="space-y-2">
                  {wfReadinessChecklist.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-2 bg-slate-800/80 p-2.5 rounded-lg border border-slate-700/50">
                      <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                      <span className="text-slate-200 leading-normal">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Trigger Specifications */}
            <div className="bg-surface rounded-2xl p-6 border border-slate-200/60 dark:border-slate-800 shadow-sm space-y-4">
              <div className="flex items-center gap-2 text-content border-b border-outline pb-2.5">
                <Clock className="w-4.5 h-4.5 text-content-secondary" />
                <h4 className="font-bold text-sm text-content">{t("template_center.modal.title_specs_wf")}</h4>
              </div>
              
              <div className="space-y-3.5 text-xs">
                <div className="space-y-1">
                  <span className="text-content-muted font-medium block">{t("template_center.modal.trigger_mode")}</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-950/50 px-2 py-1.5 rounded-lg block border border-outline/80">{wfMarketingDetail.triggerMode}</span>
                </div>
                
                {workflow.default_skills && workflow.default_skills.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-content-muted font-medium block">{t("template_center.modal.tech_skills")}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {workflow.default_skills.map((skill, sIdx) => (
                        <span key={sIdx} className="px-2 py-1 bg-control-hover text-content-secondary rounded-md border border-slate-200/60 dark:border-slate-700/50 font-semibold">
                          {formatTemplatePlugin(skill, i18n.language)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {workflow.default_channel && (
                  <div className="space-y-1">
                    <span className="text-content-muted font-medium block">{t("template_center.modal.tech_channels_wf")}</span>
                    <span className="px-2 py-1 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 rounded-md border border-emerald-100/50 dark:border-emerald-900/30 font-semibold inline-block">
                      {formatTemplateChannel(workflow.default_channel, i18n.language)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Sandbox security guarantee */}
            <DetailSandboxGuarantee text={t("template_center.modal.sandbox_promise_wf")} />

          </div>

        </div>

        {/* Footer */}
        <footer className="p-5 md:p-6 bg-surface border-t border-outline flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0 shadow-sm">
          <div className="text-xs text-content-muted flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
            {t("template_center.modal.wf_audit_desc")}
          </div>
          
          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <span className="text-[11px] text-content-muted font-medium hidden md:inline">
              {t("template_center.modal.no_code_needed")}
            </span>
            <button
              type="button"
              className="px-5 py-2.5 border border-outline hover:bg-control-hover text-content-secondary hover:text-content rounded-xl text-sm font-semibold transition-all duration-150 shrink-0 cursor-pointer"
              onClick={onClose}
            >
              {t("template_center.modal.btn_back")}
            </button>
            <button
              type="button"
              className="flex-1 sm:flex-none px-6 py-2.5 bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-slate-200 text-white dark:text-slate-900 rounded-xl text-sm font-bold transition-all duration-150 inline-flex items-center justify-center gap-1.5 shadow-md cursor-pointer"
              onClick={() => {
                onUseWorkflow(workflow.id);
                onClose();
              }}
            >
              {t("template_center.modal.btn_deploy_workflow")}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </footer>

      </div>
    </div>
  );
}
