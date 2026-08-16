import { 
  X, Layers, CheckCircle, ArrowRight, Compass, Cpu
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { IndustryBlueprint } from "./types";
import { STATIC_BLUEPRINT_GUIDES } from "./constants";
import { safeParseArray, resolveBlueprintMarketingFallback, getLocalizedBlueprint, formatTemplatePlugin, formatTemplateChannel } from "./utils";
import { DetailSourceBadge } from "./DetailSourceBadge";
import { DetailLimitationsSection } from "./DetailLimitationsSection";
import { DetailGuideStepsSection } from "./DetailGuideStepsSection";
import { DetailSandboxGuarantee } from "./DetailSandboxGuarantee";
import { DetailAudienceValueSection } from "./DetailAudienceValueSection";
import { DetailPromptSection } from "./DetailPromptSection";

interface BlueprintDetailModalProps {
  blueprint: IndustryBlueprint;
  onClose: () => void;
  onUseBlueprint: (id: string) => void;
}

export function BlueprintDetailModal({ blueprint: rawBlueprint, onClose, onUseBlueprint }: BlueprintDetailModalProps) {
  const { t, i18n } = useTranslation("dashboard");
  const blueprint = getLocalizedBlueprint(rawBlueprint, t);
  const bpMarketing = resolveBlueprintMarketingFallback(blueprint, t);

  const bpTargetAudience = blueprint.target_audience || bpMarketing.targetAudience;

  const bpBusinessImpact = (() => {
    if (blueprint.business_value) {
      if (Array.isArray(blueprint.business_value)) {
        return blueprint.business_value;
      }
      return [blueprint.business_value];
    }
    return bpMarketing.businessImpact;
  })();

  const bpReadinessChecklist = (() => {
    const parsedDb = safeParseArray(blueprint.readiness_checklist);
    if (parsedDb.length > 0) {
      return parsedDb;
    }
    return [
      ...(blueprint.required_setup_items || []),
      ...(bpMarketing.preparationNotice || [])
    ];
  })();

  const bpPostDeployGuide = (() => {
    const parsed = safeParseArray(blueprint.post_deploy_guide);
    if (parsed.length > 0) return parsed;
    return STATIC_BLUEPRINT_GUIDES[blueprint.id] || STATIC_BLUEPRINT_GUIDES[blueprint.slug] || [];
  })();

  const bpLimitations = blueprint.limitations || bpMarketing.limitations;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/75 md:backdrop-blur-md flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 z-0 touch-none" onClick={onClose} />
      <div className="bg-surface rounded-3xl w-full max-w-4xl overflow-hidden shadow-2xl relative z-10 animate-in zoom-in-95 duration-200 flex flex-col max-h-[92vh] sm:max-h-[90vh] min-h-0 text-left border border-outline">
        
        {/* Rich Indigo Header Banner */}
        <header className="bg-slate-900 text-white p-4 sm:p-6 md:p-8 relative overflow-hidden shrink-0">
          <div className="absolute top-0 right-0 w-80 h-80 bg-blue-600/15 rounded-full md:blur-3xl -z-0 pointer-events-none" />
          <div className="absolute -bottom-10 left-20 w-60 h-60 bg-emerald-500/10 rounded-full md:blur-2xl -z-0 pointer-events-none" />
          
          <div className="relative z-10 flex justify-between items-start">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] sm:text-xs font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  <Compass className="w-3.5 h-3.5" />
                  {t("template_center.modal.type_blueprint")}
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                  {t("template_center.version_label")} {blueprint.version}
                </span>
                <DetailSourceBadge item={blueprint} />
              </div>
              <h3 className="text-lg sm:text-xl md:text-2xl font-black tracking-tight text-white">{blueprint.name}</h3>
              <p className="text-xs sm:text-sm text-slate-300 max-w-2xl mt-1">{blueprint.description}</p>
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
              const el = document.getElementById("blueprint-section-value");
              if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }}
            className="shrink-0 px-2.5 py-1 rounded-lg bg-surface hover:bg-indigo-50 dark:hover:bg-slate-800 hover:text-indigo-650 dark:hover:text-indigo-300 border border-outline text-content-secondary shadow-sm transition-all duration-150 font-bold cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-500/30"
          >
            {t("template_center.modal.tab_value")}
          </button>
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById("blueprint-section-prep");
              if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }}
            className="shrink-0 px-2.5 py-1 rounded-lg bg-surface hover:bg-indigo-50 dark:hover:bg-slate-800 hover:text-indigo-650 dark:hover:text-indigo-300 border border-outline text-content-secondary shadow-sm transition-all duration-150 font-bold cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-500/30"
          >
            {t("template_center.modal.tab_prep")}
          </button>
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById("blueprint-section-context");
              if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }}
            className="shrink-0 px-2.5 py-1 rounded-lg bg-surface hover:bg-indigo-50 dark:hover:bg-slate-800 hover:text-indigo-650 dark:hover:text-indigo-300 border border-outline text-content-secondary shadow-sm transition-all duration-150 font-bold cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-500/30"
          >
            {t("template_center.modal.tab_context")}
          </button>
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById("blueprint-section-guide");
              if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }}
            className="shrink-0 px-2.5 py-1 rounded-lg bg-surface hover:bg-indigo-50 dark:hover:bg-slate-800 hover:text-indigo-650 dark:hover:text-indigo-300 border border-outline text-content-secondary shadow-sm transition-all duration-150 font-bold cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-500/30"
          >
            {t("template_center.modal.tab_guide")}
          </button>
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById("blueprint-section-limits");
              if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }}
            className="shrink-0 px-2.5 py-1 rounded-lg bg-surface hover:bg-indigo-50 dark:hover:bg-slate-800 hover:text-indigo-650 dark:hover:text-indigo-300 border border-outline text-content-secondary shadow-sm transition-all duration-150 font-bold cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-500/30"
          >
            {t("template_center.modal.tab_limits")}
          </button>
        </div>

        {/* Body Content - Dual Column */}
        <div id="blueprint-modal-body" className="p-4 sm:p-6 md:p-8 overflow-y-auto bg-slate-50/50 dark:bg-slate-950/40 flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 min-h-0 scroll-smooth [webkit-overflow-scrolling:touch] overscroll-contain touch-pan-y">
          
          {/* Left Column (2/3 width) - Positioning & Benefits */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Section 1: Business Positioning & Impact */}
            <DetailAudienceValueSection
              id="blueprint-section-value"
              title={t("template_center.modal.title_value")}
              targetAudience={bpTargetAudience}
              businessImpact={bpBusinessImpact}
              themeColor="blue"
            />

            {/* Section 2: AI System Context Preview */}
            <DetailPromptSection
              id="blueprint-section-context"
              title={t("template_center.modal.title_context")}
              prompt={blueprint.system_context_preview}
              themeColor="blue"
            />

            {/* Section 3: Next steps guide */}
            <DetailGuideStepsSection
              id="blueprint-section-guide"
              title={t("template_center.modal.title_guide")}
              steps={bpPostDeployGuide}
              themeColor="blue"
            />

            {/* Section 4: Limitations & Notes */}
            <DetailLimitationsSection
              id="blueprint-section-limits"
              title={t("template_center.modal.title_limits")}
              limitations={bpLimitations}
            />

          </div>

          {/* Right Column (1/3 width) - Requirements & Specs */}
          <div className="space-y-6">
            
            {/* Subsection 1: Actionable Requirements */}
            <div id="blueprint-section-prep" className="bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/70 dark:border-amber-900/30 rounded-2xl p-6 space-y-4 shadow-sm scroll-mt-4">
              <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 border-b border-amber-100 dark:border-amber-900/30 pb-2.5">
                <Layers className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                <h4 className="font-bold text-sm text-amber-900 dark:text-amber-200">{t("template_center.modal.title_prep")}</h4>
              </div>
              
              <div className="space-y-3.5 text-xs text-content-secondary">
                <p className="text-amber-800/80 dark:text-amber-400/80 leading-normal font-medium">{t("template_center.modal.prep_desc")}</p>
                
                <div className="space-y-2.5">
                  {bpReadinessChecklist.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-2 bg-surface/75 p-2.5 rounded-lg border border-amber-200/40 dark:border-amber-900/20">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                      <span className="font-semibold text-content-secondary leading-relaxed">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Subsection 2: Technical specs */}
            <div className="bg-surface rounded-2xl p-6 border border-slate-200/60 dark:border-slate-800 shadow-sm space-y-4">
              <div className="flex items-center gap-2 text-content border-b border-outline pb-2.5">
                <Cpu className="w-4.5 h-4.5 text-blue-600 dark:text-blue-400" />
                <h4 className="font-bold text-sm text-content">{t("template_center.modal.title_specs")}</h4>
              </div>
              
              <div className="space-y-3 text-xs">
                <div className="space-y-1">
                  <span className="text-content-muted font-medium block">{t("template_center.modal.tech_core")}</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-950/50 px-2 py-1.5 rounded-lg block border border-outline/80">{bpMarketing.techSpec}</span>
                </div>
                <div className="space-y-1">
                  <span className="text-content-muted font-medium block">{t("template_center.modal.tech_skills")}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {blueprint.recommended_skills.map((skill, sIdx) => (
                      <span key={sIdx} className="px-2 py-1 bg-blue-50 dark:bg-blue-950/35 text-blue-700 dark:text-blue-300 rounded-md border border-blue-100/50 dark:border-blue-900/30 font-semibold">
                        {formatTemplatePlugin(skill, i18n.language)}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-content-muted font-medium block">{t("template_center.modal.tech_channels")}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {blueprint.recommended_channels.map((chan, cIdx) => (
                      <span key={cIdx} className="px-2 py-1 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 rounded-md border border-emerald-100/50 dark:border-emerald-900/30 font-semibold">
                        {formatTemplateChannel(chan, i18n.language)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Subsection 3: Sandbox security promise */}
            <DetailSandboxGuarantee text={t("template_center.modal.sandbox_promise")} />

          </div>

        </div>

        {/* Elegant Footer */}
        <footer className="p-5 md:p-6 bg-surface border-t border-outline flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0 shadow-sm">
          <div className="text-xs text-content-muted flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            {t("template_center.modal.vpc_auto")}
          </div>
          
          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <span className="text-[11px] text-content-muted font-medium hidden md:inline">
              {t("template_center.modal.no_dev")}
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
              className="flex-1 sm:flex-none px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold transition-all duration-150 inline-flex items-center justify-center gap-1.5 shadow-md shadow-blue-500/10 hover:shadow-blue-500/20 cursor-pointer"
              onClick={() => {
                onUseBlueprint(blueprint.id);
                onClose();
              }}
            >
              {t("template_center.modal.btn_deploy_blueprint")}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </footer>

      </div>
    </div>
  );
}
