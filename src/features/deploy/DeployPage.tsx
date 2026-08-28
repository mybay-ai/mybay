import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Socket } from "socket.io-client";
import { useTranslation } from "react-i18next";
import { DeployWizard } from "./DeployWizard";
import { QuickDeployPage } from "./QuickDeployPage";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { 
  Compass, Terminal, ArrowRight, ArrowLeft, Search, Layout, Check, Settings
} from "lucide-react";

import { api } from "../../lib/api";
import { Card, Button } from "../../components/ui";
import { resolveBlueprintCardContent, resolveWorkflowCardContent, getRiskLevelTranslationKey } from "../../components/template-center/utils";
import type { WorkflowTemplate, IndustryBlueprint } from "../../components/template-center/types";
import type { SetupFormData } from "../../types";

export function DeployPage({ currentUser, socket, fetchInstances, instances, templateWorkflowsEnabled = false, advancedResourceConfigEnabled = false }: {
  currentUser: any, 
  socket: Socket | null, 
  fetchInstances: () => void,
  instances: any[],
  templateWorkflowsEnabled?: boolean,
  advancedResourceConfigEnabled?: boolean
}) {
  const { t, i18n } = useTranslation(["deploy", "dashboard"]);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const workflowId = templateWorkflowsEnabled ? searchParams.get("workflow_id") || undefined : undefined;
  const blueprintId = templateWorkflowsEnabled ? searchParams.get("blueprint_id") || undefined : undefined;
  const scenario = searchParams.get("scenario") || undefined;

  let templateType = templateWorkflowsEnabled ? searchParams.get("template_type") || undefined : undefined;
  let templateId = templateWorkflowsEnabled ? searchParams.get("template_id") || undefined : undefined;

  if (workflowId) {
    templateType = "workflow";
    templateId = workflowId;
  }

  // Path selection states
  const [selectedPath, setSelectedPath] = useState<"template" | "blank" | null>(templateWorkflowsEnabled ? null : "blank");
  const [workflows, setWorkflows] = useState<WorkflowTemplate[]>([]);
  const [blueprints, setBlueprints] = useState<IndustryBlueprint[]>([]);
  const [workflowsLoading, setWorkflowsLoading] = useState(false);
  const [blueprintsLoading, setBlueprintsLoading] = useState(false);
  const [workflowsLoaded, setWorkflowsLoaded] = useState(false);
  const [blueprintsLoaded, setBlueprintsLoaded] = useState(false);
  const templatesLoading = workflowsLoading || blueprintsLoading;
  const [activeTab, setActiveTab] = useState<"all" | "blueprints" | "workflows">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [deploymentMode, setDeploymentMode] = useState<"quick" | "advanced">("quick");
  const [advancedInitialData, setAdvancedInitialData] = useState<Partial<SetupFormData>>();

  useEffect(() => {
    setWorkflowsLoaded(false);
    setBlueprintsLoaded(false);
  }, [i18n.resolvedLanguage]);

  // Fetch workflows and blueprints independently so that failure of one doesn't prevent retrying
  useEffect(() => {
    if (!templateWorkflowsEnabled || selectedPath !== "template") return;

    let isMounted = true;

    const fetchWorkflows = async () => {
      if (workflowsLoaded) return;
      try {
        setWorkflowsLoading(true);
        const locale = encodeURIComponent(i18n.resolvedLanguage || i18n.language || "zh-CN");
        const wfData = await api.get(`/api/templates?lang=${locale}`);
        if (isMounted) {
          setWorkflows(wfData || []);
          setWorkflowsLoaded(true);
        }
      } catch (err) {
        console.warn("Could not fetch workflows in deploy browser:", err);
      } finally {
        if (isMounted) {
          setWorkflowsLoading(false);
        }
      }
    };

    const fetchBlueprints = async () => {
      if (blueprintsLoaded) return;
      try {
        setBlueprintsLoading(true);
        const locale = encodeURIComponent(i18n.resolvedLanguage || i18n.language || "zh-CN");
        const bpData = await api.get(`/api/templates/blueprints?lang=${locale}`);
        if (isMounted) {
          setBlueprints(bpData || []);
          setBlueprintsLoaded(true);
        }
      } catch (err) {
        console.warn("Could not fetch blueprints in deploy browser:", err);
      } finally {
        if (isMounted) {
          setBlueprintsLoading(false);
        }
      }
    };

    fetchWorkflows();
    fetchBlueprints();

    return () => {
      isMounted = false;
    };
  }, [templateWorkflowsEnabled, selectedPath, workflowsLoaded, blueprintsLoaded, i18n.resolvedLanguage, i18n.language]);

  const hasTemplateParams = templateWorkflowsEnabled && !!(blueprintId || templateId);
  const currentPath = templateWorkflowsEnabled ? (hasTemplateParams ? "template" : selectedPath) : "blank";

  // 1. Path Selection Screen
  if (currentPath === null) {
    const templateFeatures = t("deploy:path_selection.template_features", { returnObjects: true });
    const blankFeatures = t("deploy:path_selection.blank_features", { returnObjects: true });

    return (
      <div className="w-full xl:max-w-[1180px] lg:max-w-5xl md:max-w-4xl mx-auto px-4 py-8 md:py-16 animate-in fade-in duration-200">
        <div className="text-center max-w-2xl mx-auto mb-10 md:mb-16">
          <div className="inline-flex p-3 bg-blue-50 text-blue-650 rounded-2xl mb-4 shadow-sm">
            <Compass className="w-6 h-6 animate-pulse text-indigo-600" />
          </div>
          <h1 className="text-2xl md:text-3xl font-black text-content tracking-tight">
            {t("deploy:path_selection.title")}
          </h1>
          <p className="text-content-muted text-sm md:text-base mt-2 font-medium">
            {t("deploy:path_selection.title_desc")}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {/* Path A: From Business Template */}
          <Card className="p-6 md:p-8 border-outline/80 hover:border-indigo-300 shadow-sm hover:shadow-xl transition-all group flex flex-col justify-between h-full bg-surface rounded-3xl relative overflow-hidden text-left cursor-pointer" onClick={() => setSelectedPath("template")}>
            <div className="absolute -top-6 -right-6 p-8 opacity-[0.03] text-content pointer-events-none group-hover:scale-110 transition-transform duration-300">
              <Compass className="w-48 h-48" />
            </div>
            
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
                  <Compass className="w-6 h-6" />
                </div>
                <span className="px-3 py-1 bg-indigo-50 text-indigo-700 text-[11px] font-black rounded-full uppercase tracking-wider">
                  {t("dashboard:template_center.type_blueprint")}
                </span>
              </div>

              <div>
                <h3 className="text-lg md:text-xl font-bold text-content group-hover:text-indigo-600 transition-colors">
                  {t("deploy:path_selection.template_title")}
                </h3>
                <p className="text-[13px] md:text-sm text-content-muted mt-2 leading-relaxed">
                  {t("deploy:path_selection.template_desc")}
                </p>
              </div>

              <div className="space-y-2.5 pt-2">
                {Array.isArray(templateFeatures) && templateFeatures.map((feature, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-[13px] text-slate-650 font-medium">
                    <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    <span>{feature}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-8">
              <Button
                variant="primary"
                onClick={(e: any) => {
                  e.stopPropagation();
                  setSelectedPath("template");
                }}
                className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-2xl shadow-md shadow-indigo-650/10 flex items-center justify-center gap-2"
              >
                <span>{t("deploy:path_selection.btn_select_template")}</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </Card>

          {/* Path B: From Scratch */}
          <Card className="p-6 md:p-8 border-outline/80 hover:border-blue-300 shadow-sm hover:shadow-xl transition-all group flex flex-col justify-between h-full bg-surface rounded-3xl relative overflow-hidden text-left cursor-pointer" onClick={() => {
            setAdvancedInitialData(undefined);
            setDeploymentMode("quick");
            setSelectedPath("blank");
          }}>
            <div className="absolute -top-6 -right-6 p-8 opacity-[0.03] text-content pointer-events-none group-hover:scale-110 transition-transform duration-300">
              <Settings className="w-48 h-48" />
            </div>

            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl">
                  <Settings className="w-6 h-6" />
                </div>
                <span className="px-3 py-1 bg-blue-50 text-blue-700 text-[11px] font-black rounded-full uppercase tracking-wider">
                  {t("deploy:custom_engine_badge")}
                </span>
              </div>

              <div>
                <h3 className="text-lg md:text-xl font-bold text-content group-hover:text-blue-600 transition-colors">
                  {t("deploy:path_selection.blank_title")}
                </h3>
                <p className="text-[13px] md:text-sm text-content-muted mt-2 leading-relaxed">
                  {t("deploy:path_selection.blank_desc")}
                </p>
              </div>

              <div className="space-y-2.5 pt-2">
                {Array.isArray(blankFeatures) && blankFeatures.map((feature, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-[13px] text-slate-655 font-medium">
                    <Check className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                    <span>{feature}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-8">
              <Button
                variant="outline"
                onClick={(e: any) => {
                  e.stopPropagation();
                  setAdvancedInitialData(undefined);
                  setDeploymentMode("quick");
                  setSelectedPath("blank");
                }}
                className="w-full h-11 border-outline hover:border-outline-strong text-content-secondary font-bold text-sm rounded-2xl flex items-center justify-center gap-2"
              >
                <span>{t("deploy:path_selection.btn_select_blank")}</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  // 2. Business Template Browser
  if (currentPath === "template" && !hasTemplateParams) {
    const filteredBlueprints = blueprints.filter(bp => 
      bp.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      bp.description.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const filteredWorkflows = workflows.filter(wf => 
      wf.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      wf.description.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
      <div className="w-full xl:max-w-[1180px] lg:max-w-5xl md:max-w-4xl mx-auto px-4 py-8 animate-in fade-in duration-200">
        {/* Navigation & Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <button
              onClick={() => setSelectedPath(null)}
              className="flex items-center gap-2 text-[13px] font-bold text-content-muted hover:text-content transition-colors mb-2 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{t("deploy:path_selection.back_to_selection")}</span>
            </button>
            <h1 className="text-xl md:text-2xl font-black text-content tracking-tight flex items-center gap-2.5">
              <Compass className="w-5 h-5 text-indigo-500 animate-pulse" />
              <span>{t("deploy:path_selection.template_browser_title")}</span>
            </h1>
            <p className="text-content-muted text-[13px] mt-1">
              {t("deploy:path_selection.template_browser_desc")}
            </p>
          </div>
        </div>

        {/* Search & Tabs */}
        <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between mb-8 border-b border-outline pb-5">
          <div className="flex bg-surface-muted/80 p-1 rounded-xl self-start">
            <button
              onClick={() => setActiveTab("all")}
              className={`px-4 py-1.5 text-[13px] font-bold rounded-lg transition-all cursor-pointer ${activeTab === "all" ? "bg-surface text-content shadow-sm" : "text-content-muted hover:text-content"}`}
            >
              {t("deploy:path_selection.tab_all")}
            </button>
            <button
              onClick={() => setActiveTab("blueprints")}
              className={`px-4 py-1.5 text-[13px] font-bold rounded-lg transition-all cursor-pointer ${activeTab === "blueprints" ? "bg-surface text-content shadow-sm" : "text-content-muted hover:text-content"}`}
            >
              {t("deploy:path_selection.tab_blueprints")}
            </button>
            <button
              onClick={() => setActiveTab("workflows")}
              className={`px-4 py-1.5 text-[13px] font-bold rounded-lg transition-all cursor-pointer ${activeTab === "workflows" ? "bg-surface text-content shadow-sm" : "text-content-muted hover:text-content"}`}
            >
              {t("deploy:path_selection.tab_workflows")}
            </button>
          </div>

          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-content-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder={t("dashboard:template_center.search_solutions")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-9 pl-9 pr-4 rounded-xl border border-outline bg-surface placeholder:text-content-muted text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all shadow-sm text-content"
            />
          </div>
        </div>

        {/* Loading State */}
        {templatesLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="bg-surface rounded-3xl border border-outline p-6 space-y-4 animate-pulse h-52" />
            ))}
          </div>
        ) : (
          <div className="space-y-8">
            {/* 1. Blueprints (Solutions) */}
            {(activeTab === "all" || activeTab === "blueprints") && (
              <div className="space-y-4">
                {activeTab === "all" && filteredBlueprints.length > 0 && (
                  <h2 className="text-sm font-black text-content uppercase tracking-wider flex items-center gap-2 border-l-4 border-indigo-500 pl-2.5">
                    <Layout className="w-4 h-4 text-indigo-500" />
                    <span>{t("dashboard:template_center.tab_solutions")}</span>
                  </h2>
                )}
                {filteredBlueprints.length === 0 ? (
                  activeTab === "blueprints" && (
                    <div className="text-center py-12 bg-surface-muted/50 rounded-3xl border border-outline text-content-muted text-sm font-medium">
                      {t("dashboard:template_center.not_found_solutions")}
                    </div>
                  )
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {filteredBlueprints.map((bp) => {
                      const cardContent = resolveBlueprintCardContent(bp, t);
                      return (
                        <Card key={bp.id} className="p-6 border-slate-105 hover:border-indigo-200/80 shadow-sm hover:shadow-md transition-all bg-surface rounded-3xl flex flex-col justify-between h-full relative overflow-hidden group text-left">
                          <div className="space-y-3">
                            <div className="flex justify-between items-start">
                              <span className="px-2.5 py-0.5 bg-indigo-50 text-indigo-600 text-[11px] font-black rounded-full uppercase tracking-wider">
                                {t("dashboard:template_center.version_label")} {bp.version}
                              </span>
                            </div>
                            
                            <div>
                              <h3 className="font-extrabold text-content text-base group-hover:text-indigo-600 transition-colors">
                                {bp.name}
                              </h3>
                              <p className="text-[13px] text-content-muted mt-1.5 leading-relaxed line-clamp-3">
                                {bp.description}
                              </p>
                            </div>

                            {cardContent.targetAudience && (
                              <div className="text-[13px] text-content-secondary font-medium leading-relaxed flex items-center gap-1.5 pt-1.5 border-t border-outline">
                                <span className="text-indigo-600 font-bold shrink-0">🎯 {t("dashboard:template_center.target_audience_label")}:</span>
                                <span className="truncate text-content-secondary">{cardContent.targetAudience}</span>
                              </div>
                            )}

                            {cardContent.businessValuePreview && (
                              <div className="text-[13px] text-slate-650 font-medium leading-relaxed flex items-center gap-1.5">
                                <span className="text-emerald-600 font-bold shrink-0">💰 {t("dashboard:template_center.business_value_label")}:</span>
                                <span className="truncate text-content-secondary">{cardContent.businessValuePreview}</span>
                              </div>
                            )}
                          </div>
                          
                          <div className="mt-6 pt-4 border-t border-outline flex items-center justify-end">
                            <Button 
                              onClick={() => setSearchParams({ template_type: "blueprint", blueprint_id: bp.id })}
                              className="h-9 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[13px] rounded-xl px-4 transition-all flex items-center gap-1"
                            >
                              <span>{t("dashboard:template_center.btn_deploy_blueprint")}</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* 2. Workflows */}
            {(activeTab === "all" || activeTab === "workflows") && (
              <div className="space-y-4 pt-4">
                {activeTab === "all" && filteredWorkflows.length > 0 && (
                  <h2 className="text-sm font-black text-content uppercase tracking-wider flex items-center gap-2 border-l-4 border-emerald-500 pl-2.5">
                    <Terminal className="w-4 h-4 text-emerald-500" />
                    <span>{t("dashboard:template_center.tab_workflows")}</span>
                  </h2>
                )}
                {filteredWorkflows.length === 0 ? (
                  activeTab === "workflows" && (
                    <div className="text-center py-12 bg-surface-muted/50 rounded-3xl border border-outline text-content-muted text-sm font-medium">
                      {t("dashboard:template_center.not_found_workflows")}
                    </div>
                  )
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {filteredWorkflows.map((wf) => {
                      const cardContent = resolveWorkflowCardContent(wf, t);
                      return (
                        <Card key={wf.id} className="p-6 border-slate-105 hover:border-emerald-200/80 shadow-sm hover:shadow-md transition-all bg-surface rounded-3xl flex flex-col justify-between h-full relative overflow-hidden group text-left">
                          <div className="space-y-3">
                            <div className="flex justify-between items-start">
                              <span className="px-2.5 py-0.5 bg-emerald-50 text-emerald-700 text-[11px] font-black rounded-full uppercase tracking-wider">
                                {t("dashboard:template_center.risk_label")}: {t(`dashboard:${getRiskLevelTranslationKey(wf.risk_level)}`)}
                              </span>
                            </div>
                            
                            <div>
                              <h3 className="font-extrabold text-content text-base group-hover:text-emerald-600 transition-colors">
                                {wf.name}
                              </h3>
                              <p className="text-[13px] text-content-muted mt-1.5 leading-relaxed line-clamp-3">
                                {wf.description}
                              </p>
                            </div>

                            {cardContent.targetAudience && (
                              <div className="text-[13px] text-content-secondary font-medium leading-relaxed flex items-center gap-1.5 pt-1.5 border-t border-outline">
                                <span className="text-emerald-600 font-bold shrink-0">🎯 {t("dashboard:template_center.target_audience_label")}:</span>
                                <span className="truncate text-content-secondary">{cardContent.targetAudience}</span>
                              </div>
                            )}

                            {cardContent.automationResultPreview && (
                              <div className="text-[13px] text-slate-655 font-medium leading-relaxed flex items-center gap-1.5">
                                <span className="text-indigo-650 font-bold shrink-0">💰 {t("dashboard:template_center.business_value_label")}:</span>
                                <span className="truncate text-content-secondary">{cardContent.automationResultPreview}</span>
                              </div>
                            )}
                          </div>
                          
                          <div className="mt-6 pt-4 border-t border-outline flex items-center justify-end">
                            <Button 
                              onClick={() => setSearchParams({ template_type: "workflow", template_id: wf.id })}
                              className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[13px] rounded-xl px-4 transition-all flex items-center gap-1"
                            >
                              <span>{t("dashboard:template_center.btn_use_workflow")}</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // 3. Deployment Wizard (for blank path or active template deployment)
  if (currentPath === "blank" && deploymentMode === "quick") {
    return (
      <ErrorBoundary>
        <QuickDeployPage
          currentUser={currentUser}
          onAdvanced={(initialData) => {
            setAdvancedInitialData(initialData);
            setDeploymentMode("advanced");
          }}
          onCreated={() => {
            fetchInstances();
          }}
          onOpenChat={(instanceId) => navigate(`/app/chat?instanceId=${encodeURIComponent(instanceId)}`)}
          onViewInstances={() => navigate("/app/instances")}
        />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <DeployWizard 
        currentUser={currentUser}
        socket={socket}
        instances={instances}
        templateWorkflowsEnabled={templateWorkflowsEnabled}
        advancedResourceConfigEnabled={advancedResourceConfigEnabled}
        templateType={templateWorkflowsEnabled ? templateType : undefined}
        templateId={templateWorkflowsEnabled ? templateId : undefined}
        blueprintId={templateWorkflowsEnabled ? blueprintId : undefined}
        onClearTemplateParams={() => {
          setSearchParams({});
          setSelectedPath(null); // Back to choice
        }}
        onUpdateTemplateParams={(params: { template_type?: string; template_id?: string; blueprint_id?: string }) => {
          const newParams: Record<string, string> = {};
          if (params.template_type) newParams.template_type = params.template_type;
          if (params.template_id) newParams.template_id = params.template_id;
          if (params.blueprint_id) newParams.blueprint_id = params.blueprint_id;
          setSearchParams(newParams);
        }}
        onBackToSelection={currentPath === "blank"
          ? () => setDeploymentMode("quick")
          : templateWorkflowsEnabled && !hasTemplateParams
            ? () => setSelectedPath(null)
            : undefined}
        initialData={currentPath === "blank" ? advancedInitialData : undefined}
        onSuccess={(targetRoute?: string) => {
          fetchInstances();
          if (targetRoute) {
            navigate(targetRoute);
          } else {
            navigate("/app/instances");
          }
        }}
        onViewGuide={(guideId: string) => {
          navigate(`/app/guides?guide=${guideId}`);
        }}
      />
    </ErrorBoundary>
  );
}
