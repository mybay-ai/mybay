import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Sparkles, ArrowRight, Search, Compass, Terminal, Target, Coins
} from "lucide-react";
import { APP_ROUTES } from "../constants/routes";
import { api } from "../lib/api";

import { WorkflowTemplate, IndustryBlueprint } from "./template-center/types";
import { BlueprintDetailModal } from "./template-center/BlueprintDetailModal";
import { WorkflowDetailModal } from "./template-center/WorkflowDetailModal";
import { getRiskLevelTranslationKey, resolveBlueprintCardContent, resolveWorkflowCardContent, getReadinessMeta, getLocalizedBlueprint, getLocalizedWorkflow, formatTemplatePluginsList, formatTemplateChannelsList } from "./template-center/utils";

interface TemplateCenterProps {
  currentUser: any;
  instances?: any[];
}

export function TemplateCenter({ currentUser, instances = [] }: TemplateCenterProps) {
  const { t, i18n } = useTranslation("dashboard");
  const navigate = useNavigate();
  const [activeTab, setActiveTab ] = useState<"industry" | "workflow">(() => {
    const saved = localStorage.getItem("mybay_template_center_tab");
    return (saved === "workflow" || saved === "industry") ? saved : "industry";
  });
  const [searchQuery, setSearchQuery] = useState(() => {
    return localStorage.getItem("mybay_template_center_search") || "";
  });

  useEffect(() => {
    localStorage.setItem("mybay_template_center_tab", activeTab);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem("mybay_template_center_search", searchQuery);
  }, [searchQuery]);

  const [workflows, setWorkflows] = useState<WorkflowTemplate[]>([]);
  const [blueprints, setBlueprints] = useState<IndustryBlueprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBlueprint, setSelectedBlueprint] = useState<IndustryBlueprint | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowTemplate | null>(null);

  const [targetWorkflowId, setTargetWorkflowId] = useState<string | null>(null);
  const [hasScrolledToTarget, setHasScrolledToTarget] = useState(false);
  const [hasOpenedTargetDetail, setHasOpenedTargetDetail] = useState(false);
  const [lastTargetWfId, setLastTargetWfId] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        setError(null);

        // Fetch Workflows & Blueprints in parallel using the unified api.get helper
        const [wfData, bpData] = await Promise.all([
          api.get(`/api/templates?lang=${encodeURIComponent(i18n.resolvedLanguage || i18n.language || "zh-CN")}`),
          api.get(`/api/templates/blueprints?lang=${encodeURIComponent(i18n.resolvedLanguage || i18n.language || "zh-CN")}`).catch((err) => {
            console.warn("Could not fetch blueprints:", err);
            return null; // Gracefully degrade if blueprints fetch fails, keeping workflows intact
          })
        ]);

        if (wfData) {
          setWorkflows(wfData || []);
        }

        if (bpData) {
          setWorkprintsAndSpecs(bpData || []);
        } else {
          console.warn("Using empty list for blueprints due to request failure");
        }
      } catch (err: any) {
        console.error("Failed to load templates:", err);
        setError(t("template_center.error_loading"));
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [currentUser, i18n.resolvedLanguage]);

  // Helper to ensure blueprints are set correctly
  const setWorkprintsAndSpecs = (data: any[]) => {
    setBlueprints(data);
  };

  useEffect(() => {
    if (loading || error) return;
    const params = new URLSearchParams(window.location.search);
    const bpId = params.get("blueprint_id");
    let wfId = params.get("workflow_id");
    const tab = params.get("tab");
    const scenario = params.get("scenario");

    if (scenario && !wfId) {
      if (scenario === "pdf-summary") {
        wfId = "pdf-summary";
      } else if (scenario === "news-summary") {
        wfId = "daily-news-briefing";
      } else if (scenario === "customer-reply") {
        wfId = "lead-form-auto-reply";
      }
    }

    if (tab === "workflow" || tab === "industry" || (scenario && !tab)) {
      setActiveTab((tab as "workflow" | "industry") || "workflow");
    }

    if (bpId && blueprints.length > 0) {
      const found = blueprints.find(b => b.id === bpId);
      if (found) {
        setSelectedBlueprint(found);
        setActiveTab("industry");
      }
    } else if (wfId && workflows.length > 0) {
      const found = workflows.find(w => w.id === wfId);
      if (found) {
        if (wfId !== lastTargetWfId) {
          setLastTargetWfId(wfId);
          setHasScrolledToTarget(false);
          setHasOpenedTargetDetail(false);
        }
        setTargetWorkflowId(wfId);
        if (!hasOpenedTargetDetail) {
          setSelectedWorkflow(found);
          setHasOpenedTargetDetail(true);
        }
        setActiveTab("workflow");
      }
    }
  }, [loading, error, blueprints, workflows, hasOpenedTargetDetail, lastTargetWfId]);

  useEffect(() => {
    if (loading || !targetWorkflowId || hasScrolledToTarget || activeTab !== "workflow") return;

    const timer = setTimeout(() => {
      const element = document.getElementById(`workflow-card-${targetWorkflowId}`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        setHasScrolledToTarget(true);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [loading, targetWorkflowId, hasScrolledToTarget, activeTab]);

  const handleUseWorkflow = (wfId: string) => {
    const searchParams = new URLSearchParams(location.search);
    const scenario = searchParams.get("scenario");
    let dest = `${APP_ROUTES.DEPLOY}?template_type=workflow&workflow_id=${wfId}`;
    if (scenario) {
      dest += `&scenario=${encodeURIComponent(scenario)}`;
    }
    navigate(dest);
  };

  const handleUseBlueprint = (bpId: string) => {
    navigate(`${APP_ROUTES.DEPLOY}?template_type=blueprint&blueprint_id=${bpId}`);
  };

  // Localize lists first
  const localizedBlueprintsList = useMemo(() => {
    return blueprints.map(bp => getLocalizedBlueprint(bp, t));
  }, [blueprints, t]);

  const localizedWorkflowsList = useMemo(() => {
    return workflows.map(wf => getLocalizedWorkflow(wf, t));
  }, [workflows, t]);

  // Filter lists based on query on localized values
  const filteredBlueprints = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return localizedBlueprintsList;
    return localizedBlueprintsList.filter(bp =>
      bp.name.toLowerCase().includes(query) ||
      bp.description.toLowerCase().includes(query)
    );
  }, [localizedBlueprintsList, searchQuery]);

  const filteredWorkflows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return localizedWorkflowsList;
    return localizedWorkflowsList.filter(wf =>
      wf.name.toLowerCase().includes(query) ||
      wf.description.toLowerCase().includes(query)
    );
  }, [localizedWorkflowsList, searchQuery]);

  return (
    <div className="space-y-8 animate-fade-in pb-16">
      {/* Hero Header */}
      <div className="bg-slate-900 rounded-3xl p-8 sm:p-12 text-white relative overflow-hidden shadow-xl border border-slate-800">
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl -z-1" />
        <div className="absolute -bottom-10 -left-10 w-80 h-80 bg-emerald-600/5 rounded-full blur-3xl -z-1" />

        <div className="max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-500/10 text-blue-400 rounded-full text-xs font-semibold border border-blue-500/20">
            <Sparkles className="w-3.5 h-3.5" />
            <span>{t("template_center.header_sparkle")}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">{t("template_center.header_title")}</h1>
          <p className="text-base text-slate-300 leading-relaxed max-w-2xl">
            {t("template_center.header_desc")}
          </p>
          <div className="pt-2">
            <button
              onClick={() => navigate('/demo')}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-surface/10 hover:bg-surface/20 text-white rounded-xl text-sm font-medium transition-colors border border-white/10"
            >
              <Terminal className="w-4 h-4" />
              {t("template_center.btn_demo_hub")}
            </button>
          </div>
        </div>
      </div>

      {/* Categories & Search */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-center bg-surface p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
        {/* Tabs */}
        <div className="flex bg-slate-100 dark:bg-slate-950/50 p-1 rounded-xl w-full sm:w-auto">
          <button
            type="button"
            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              activeTab === "industry"
                ? "bg-white text-slate-900 dark:bg-slate-800 dark:text-slate-100 shadow-sm"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            }`}
            onClick={() => {
              setActiveTab("industry");
              setSearchQuery("");
            }}
          >
            <Compass className="w-4 h-4" />
            {t("template_center.tab_solutions")}
          </button>
          <button
            type="button"
            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              activeTab === "workflow"
                ? "bg-white text-slate-900 dark:bg-slate-800 dark:text-slate-100 shadow-sm"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            }`}
            onClick={() => {
              setActiveTab("workflow");
              setSearchQuery("");
            }}
          >
            <Terminal className="w-4 h-4" />
            {t("template_center.tab_workflows")}
          </button>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-content-muted" />
          <input
            type="text"
            placeholder={activeTab === "industry" ? t("template_center.search_solutions") : t("template_center.search_workflows")}
            className="w-full pl-9 pr-4 py-2.5 bg-slate-50 dark:bg-slate-950/60 border border-outline rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors text-content placeholder-slate-400 dark:placeholder-slate-500"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Loading & Errors */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((n) => (
            <div key={n} className="bg-surface rounded-2xl border border-outline p-6 space-y-4 animate-pulse">
              <div className="h-6 bg-slate-200 dark:bg-slate-800 rounded-md w-2/3" />
              <div className="space-y-2">
                <div className="h-4 bg-control-hover rounded-md w-full" />
                <div className="h-4 bg-control-hover rounded-md w-4/5" />
              </div>
              <div className="pt-4 flex justify-between items-center">
                <div className="h-8 bg-slate-200 dark:bg-slate-800 rounded-md w-20" />
                <div className="h-8 bg-slate-200 dark:bg-slate-800 rounded-lg w-28" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="bg-red-50 text-red-700 p-6 rounded-2xl border border-red-100 text-center text-sm font-medium">
          {error}
        </div>
      ) : (
        <>
          {/* Industry Blueprints Content */}
          {activeTab === "industry" && (
            <div>
              {filteredBlueprints.length === 0 ? (
                <div className="text-center py-16 bg-surface rounded-2xl border border-outline text-content-muted text-sm">
                  {t("template_center.not_found_solutions")}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {filteredBlueprints.map((rawBp) => {
                    const bp = getLocalizedBlueprint(rawBp, t);
                    return (
                      <div
                        key={bp.id}
                        className="bg-surface rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-md transition-all flex flex-col justify-between overflow-hidden group hover:border-indigo-300 dark:hover:border-indigo-500/40"
                      >
                      <div className="p-6 sm:p-8 space-y-5">
                        <div className="flex justify-between items-start">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-900/50 uppercase tracking-wider">
                            {t("template_center.version_label")} {bp.version}
                          </span>
                        </div>

                        <div className="space-y-2 text-left">
                          <h3 className="text-xl font-bold text-content group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                            {bp.name}
                          </h3>
                          <p className="text-sm text-content-secondary leading-relaxed">
                            {bp.description}
                          </p>
                        </div>

                        {/* Expressive Business Target & Impact Section */}
                        {(() => {
                          const cardContent = resolveBlueprintCardContent(bp, t);
                          return (
                            <>
                              {cardContent.targetAudience && (
                                <div className="p-3.5 bg-slate-50/70 dark:bg-slate-950/40 border border-outline rounded-2xl space-y-1.5 text-left">
                                  <span className="text-[10px] font-bold text-content-muted uppercase tracking-wider flex items-center gap-1.5">
                                    <Target className="w-3.5 h-3.5 shrink-0 text-content-muted" />
                                    <span>{t("template_center.target_audience_label")}</span>
                                  </span>
                                  <p className="text-[13px] text-content-secondary font-medium leading-relaxed">
                                    {cardContent.targetAudience}
                                  </p>
                                </div>
                              )}

                              {cardContent.businessValuePreview && (
                                <div className="p-3.5 bg-emerald-50/35 dark:bg-emerald-950/15 border border-emerald-100/40 dark:border-emerald-900/20 rounded-2xl space-y-1.5 text-left">
                                  <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                                    <Coins className="w-3.5 h-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                                    <span>{t("template_center.business_value_label")}</span>
                                  </span>
                                  <p className="text-[13px] text-content-secondary font-medium leading-relaxed">
                                    {cardContent.businessValuePreview}
                                  </p>
                                </div>
                              )}
                            </>
                          );
                        })()}

                        {/* Metadata previews */}
                        <div className="grid grid-cols-2 gap-3 pt-1 text-xs">
                          <div className="p-3 bg-slate-50/50 dark:bg-slate-950/20 border border-slate-100/50 dark:border-slate-800/40 rounded-xl space-y-1 text-left">
                            <span className="text-content-muted font-semibold block">{t("template_center.skills_label")}</span>
                            <span className="font-bold text-content-secondary truncate block">
                              {formatTemplatePluginsList(bp.recommended_skills, i18n.language)}
                            </span>
                          </div>
                          <div className="p-3 bg-slate-50/50 dark:bg-slate-950/20 border border-slate-100/50 dark:border-slate-800/40 rounded-xl space-y-1 text-left">
                            <span className="text-content-muted font-semibold block">{t("template_center.channels_label")}</span>
                            <span className="font-bold text-content-secondary truncate block">
                              {formatTemplateChannelsList(bp.recommended_channels, i18n.language)}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="px-6 py-4 bg-surface-muted border-t border-outline flex gap-3 justify-end leading-none">
                        <button
                          type="button"
                          className="px-4 py-2 text-content-secondary hover:text-slate-900 dark:hover:text-slate-200 text-sm font-semibold transition-colors"
                          onClick={() => setSelectedBlueprint(bp)}
                        >
                          {t("template_center.btn_details")}
                        </button>
                        <button
                          type="button"
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-colors inline-flex items-center gap-1.5 shadow-sm"
                          onClick={() => handleUseBlueprint(bp.id)}
                        >
                          {t("template_center.btn_deploy_blueprint")}
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Workflow Templates Content */}
          {activeTab === "workflow" && (
            <div>
              {filteredWorkflows.length === 0 ? (
                <div className="text-center py-16 bg-surface rounded-2xl border border-outline text-content-muted text-sm">
                  {t("template_center.not_found_workflows")}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredWorkflows.map((rawWf) => {
                    const wf = getLocalizedWorkflow(rawWf, t);
                    return (
                      <div
                        key={wf.id}
                        id={`workflow-card-${wf.id}`}
                        className={`rounded-2xl p-5 md:p-6 flex flex-col justify-between hover:-translate-y-0.5 transition-all group text-left h-full ${
                          wf.id === targetWorkflowId
                            ? "bg-surface border-2 border-emerald-500 dark:border-emerald-500 shadow-lg shadow-emerald-500/10 dark:shadow-emerald-950/20 ring-4 ring-emerald-500/15 dark:ring-emerald-500/10"
                            : "bg-surface border border-slate-200/60 dark:border-slate-800 hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-500/40"
                        }`}
                      >
                      <div className="space-y-5">
                        {wf.id === targetWorkflowId && (
                          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 rounded-full text-xs font-bold border border-emerald-200 dark:border-emerald-900/30 shadow-sm self-start">
                            <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                            <span>{t("template_center.recommendation_badge")}</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center gap-2">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-50/70 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 border border-amber-200/50 dark:border-amber-900/30">
                            {t("template_center.risk_label")}: {t(getRiskLevelTranslationKey(wf.risk_level))}
                          </span>
                          <div className="flex gap-1.5">
                            {wf.capability_level && wf.capability_level !== "production" && (
                              <span className={`inline-flex items-center px-2 py-1 rounded-lg text-xs font-semibold border ${
                                wf.capability_level === "beta"
                                  ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-900/40"
                                  : "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-900/40"
                              }`} title={wf.capability_level === "beta" ? "功能可用，建议先验证配置" : "演示级能力，部分外部集成可能需要额外配置"}>
                                {wf.capability_level === "beta" ? "Beta" : "Demo"}
                              </span>
                            )}
                            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold border ${getReadinessMeta(wf.readiness, t).bgClass}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${getReadinessMeta(wf.readiness, t).dotClass}`} />
                              <span>{getReadinessMeta(wf.readiness, t).text}</span>
                            </span>
                            <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-50 dark:bg-slate-950/50 text-content-secondary border border-slate-200/60 dark:border-slate-800">
                              {t("template_center.type_workflow")}
                            </span>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <h4 className="text-base md:text-lg font-bold text-content group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors leading-snug">
                            {wf.name}
                          </h4>
                          <p className="text-sm text-content-muted leading-relaxed line-clamp-3">
                            {wf.description}
                          </p>
                        </div>

                        {/* Workflow Expressive Target Audience & Automation Result */}
                        {(() => {
                          const cardContent = resolveWorkflowCardContent(wf, t);
                          return (
                            <div className="space-y-3">
                              {cardContent.targetAudience && (
                                <div className="p-3.5 bg-slate-50/70 dark:bg-slate-950/40 border border-slate-100/80 dark:border-slate-800 rounded-2xl space-y-1.5 text-left">
                                  <span className="text-[10px] font-bold text-content-muted uppercase tracking-wider flex items-center gap-1.5">
                                    <Target className="w-3.5 h-3.5 shrink-0 text-content-muted" />
                                    <span>{t("template_center.target_audience_label")}</span>
                                  </span>
                                  <p className="text-[13px] text-content-secondary font-medium leading-relaxed line-clamp-2">
                                    {cardContent.targetAudience}
                                  </p>
                                </div>
                              )}

                              {cardContent.automationResultPreview && (
                                <div className="p-3.5 bg-emerald-50/35 dark:bg-emerald-950/15 border border-emerald-100/40 dark:border-emerald-900/20 rounded-2xl space-y-1.5 text-left">
                                  <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                                    <Coins className="w-3.5 h-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                                    <span>{t("template_center.business_value_label")}</span>
                                  </span>
                                  <p className="text-[13px] text-content-secondary font-medium leading-relaxed line-clamp-2">
                                    {cardContent.automationResultPreview}
                                  </p>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>

                      <div className="pt-5 border-t border-slate-100/80 dark:border-slate-800 mt-6 flex justify-between items-center gap-3">
                        <button
                          type="button"
                          className="px-3.5 py-2 text-xs md:text-sm text-content-muted hover:text-slate-800 dark:hover:text-slate-200 font-semibold transition-colors min-h-[40px] flex items-center justify-center cursor-pointer"
                          onClick={() => setSelectedWorkflow(wf)}
                        >
                          {t("template_center.view_params")}
                        </button>
                        <button
                          type="button"
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs md:text-sm font-semibold rounded-xl transition-all inline-flex items-center gap-1.5 shadow-sm hover:shadow active:scale-[0.98] min-h-[40px] cursor-pointer"
                          onClick={() => handleUseWorkflow(wf.id)}
                        >
                          {t("template_center.btn_use_workflow")}
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Blueprint Detail Modal */}
      {selectedBlueprint && (
        <BlueprintDetailModal
          blueprint={selectedBlueprint}
          onClose={() => setSelectedBlueprint(null)}
          onUseBlueprint={handleUseBlueprint}
        />
      )}

      {/* Workflow Detail Modal */}
      {selectedWorkflow && (
        <WorkflowDetailModal
          workflow={selectedWorkflow}
          onClose={() => setSelectedWorkflow(null)}
          onUseWorkflow={handleUseWorkflow}
          isRecommended={selectedWorkflow.id === targetWorkflowId}
        />
      )}
    </div>
  );
}
