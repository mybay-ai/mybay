import { getAuthToken } from "../../lib/auth";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card } from "../ui";
import { CheckCircle2, AlertCircle, Info, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";

interface InstanceRuntimeContextViewerProps {
  instanceId: string;
}

export function InstanceRuntimeContextViewer({ instanceId }: InstanceRuntimeContextViewerProps) {
  const { t, i18n } = useTranslation("dashboard");
  const [context, setContext] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runningTask, setRunningTask] = useState(false);
  const [taskResult, setTaskResult] = useState<any>(null);
  const navigate = useNavigate();
  const [runs, setRuns] = useState<any[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);

  const fetchRuns = async () => {
    try {
      setRunsLoading(true);
      setRunsError(null);
      const token = getAuthToken();
      const headers: Record<string, string> = {};
      if (token && token !== "null" && token !== "undefined") {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch(`/api/instances/${instanceId}/business-runs?limit=5`, {
        headers
      });
      if (!res.ok) {
        throw new Error(t("error_loading_runs"));
      }
      const data = await res.json();
      setRuns(data.runs || []);
    } catch (e: any) {
      console.error("Failed to fetch runs:", e);
      setRunsError(e.message || t("error_loading_runs"));
    } finally {
      setRunsLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    const token = getAuthToken();
    const headers: Record<string, string> = {};
    if (token && token !== "null" && token !== "undefined") {
      headers["Authorization"] = `Bearer ${token}`;
    }
    fetch(`/api/instances/${instanceId}/runtime-context`, {
      headers
    })
      .then(res => {
        if (!res.ok) throw new Error(t("error_loading_context"));
        return res.json();
      })
      .then(data => {
        if (isMounted) setContext(data);
      })
      .catch(err => {
        if (isMounted) setError(err.message);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });
    
    fetchRuns();
    
    return () => { isMounted = false; };
  }, [instanceId]);

  const handleRunTask = async () => {
    try {
      setRunningTask(true);
      setTaskResult(null);
      const token = getAuthToken();
      const headers: Record<string, string> = {};
      if (token && token !== "null" && token !== "undefined") {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch(`/api/instances/${instanceId}/run-business-task`, {
        method: "POST",
        headers
      });
      const data = await res.json();
      if (!res.ok) {
        const missingRequirements = Array.isArray(data.missing_requirements) ? data.missing_requirements : [];
        const isShopUrlMissing = data.error === "WORKFLOW_CONFIG_REQUIRED" && missingRequirements.includes("shopUrl");
        if (isShopUrlMissing && /(ecommerce|cross-border|competitor)/i.test(context?.templateKey || "")) {
          setTaskResult({ success: false, error: t("shop_url_required"), needsSetupUrl: true });
          return;
        }
        throw new Error(data.message || data.error || t("task_trigger_error"));
      }
      setTaskResult({ success: true, data });
      fetchRuns(); // Refresh runs after success
    } catch (err: any) {
      setTaskResult({ success: false, error: err.message });
    } finally {
      setRunningTask(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex justify-center text-content-muted">
        <div className="w-5 h-5 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mr-2" />
        {t("loading_context")}
      </div>
    );
  }

  if (error || !context) {
    return (
      <div className="p-6 text-rose-500 flex items-center justify-center">
        <AlertCircle className="w-4 h-4 mr-2" />
        {t("error_loading_context")}
      </div>
    );
  }

  const { mode, summary, businessContext, templateKey } = context;
  const isEcommerce = /(ecommerce|competitor-price-monitor|cross-border-ecom)/i.test(templateKey);

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between p-3 sm:p-4 bg-emerald-50 border border-emerald-100 rounded-xl">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
          <div>
            <h4 className="text-sm font-semibold text-emerald-900">{t("context_applied_title")}</h4>
            <p className="text-[13px] text-emerald-700 mt-0.5">
              {t("context_applied_desc")}
            </p>
          </div>
        </div>
        <div className="hidden sm:block text-right">
          <div className="text-[13px] font-mono text-emerald-600 bg-emerald-100/50 px-2 py-1 rounded">
            {t("template_recognition")}: {templateKey}
          </div>
        </div>
      </div>

      {isEcommerce && (
        <Card className="p-4 border-indigo-100 bg-indigo-50/30">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h4 className="text-sm font-semibold text-indigo-900">
                {t("run_initial_task_title")}
              </h4>
              <p className="text-[13px] text-indigo-700 mt-0.5">
                {t("run_initial_task_desc")}
              </p>
            </div>
            <button
              onClick={handleRunTask}
              disabled={runningTask}
              className="shrink-0 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center"
            >
              {runningTask ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                  {t("task_triggering")}
                </>
              ) : (
                t("run_initial_task")
              )}
            </button>
          </div>
          {taskResult && (
            <div className={`mt-4 p-3 rounded-lg border ${taskResult.success ? 'bg-emerald-50 border-emerald-100 text-emerald-800' : 'bg-rose-50 border-rose-100 text-rose-800'}`}>
              <div className="flex items-center gap-2 mb-2">
                {taskResult.success ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <AlertCircle className="w-4 h-4 text-rose-500" />}
                <span className="text-sm font-semibold">
                  {taskResult.success ? t("task_trigger_success") : t("task_trigger_error")}
                </span>
              </div>
              {!taskResult.success && (
                <div className="text-[13px] mt-1 text-rose-600 flex items-center justify-between">
                  <span>{taskResult.error}</span>
                  {taskResult.needsSetupUrl && (
                    <Button 
                      size="sm" 
                      onClick={() => navigate(`/app/instances/${instanceId}/setup?section=shop-monitor`)}
                      className="bg-rose-600 hover:bg-rose-700 text-white rounded-md px-2 py-0.5 text-[11px]"
                    >
                      {t("go_fill_config")}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="mt-6 space-y-4">
            {runsError ? (
              <div className="p-4 text-center text-sm text-rose-500 bg-rose-50 border border-rose-200 border-dashed rounded-lg">
                {t("error_loading_runs")}: {runsError}
              </div>
            ) : runsLoading ? (
              <div className="p-4 text-center text-sm text-content-muted bg-surface/50 border border-outline border-dashed rounded-lg">
                {t("loading_runs")}
              </div>
            ) : runs.length === 0 ? (
              <div className="p-4 text-center text-sm text-content-muted bg-surface/50 border border-outline border-dashed rounded-lg">
                {t("no_recent_runs")}
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <h5 className="text-[13px] font-semibold text-indigo-900 uppercase tracking-wider">{t("latest_run_summary")}</h5>
                  <div className="p-3 bg-surface/60 border border-indigo-100 rounded-lg text-[13px] space-y-1">
                    <div className="flex items-center justify-between border-b border-indigo-50/50 pb-2 mb-2">
                      <span className="font-medium text-content-secondary">{t("latest_run_time")}</span>
                      <span className="text-content">{new Date(runs[0].timestamp).toLocaleString(i18n.resolvedLanguage || i18n.language)}</span>
                    </div>
                    {runs[0].status === 'failed' ? (
                      <>
                        <div className="flex justify-between">
                          <span className="text-content-muted">{t("run_type_label")}</span>
                          <span className="font-mono text-rose-700">{runs[0].runType || t("unknown_value")}</span>
                        </div>
                        <div className="flex flex-col mt-2 pt-2 border-t border-rose-100">
                          <span className="text-content-muted mb-1">{t("run_error_label")}</span>
                          <span className="text-rose-700 break-words">{runs[0].error || t("unknown_error")}</span>
                        </div>
                      </>
                    ) : runs[0].result_json ? (
                      <>
                        <div className="flex justify-between">
                          <span className="text-content-muted">{t("run_type_label")}</span>
                          <span className="font-mono text-indigo-700">{runs[0].result_json.runType}</span>
                        </div>
                        {runs[0].result_json.taskIntent && (
                          <div className="flex justify-between">
                            <span className="text-content-muted">{t("task_intent_label")}</span>
                            <span className="font-mono text-indigo-700 truncate max-w-[200px]">{runs[0].result_json.taskIntent}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-content-muted">{t("shop_url_label")}</span>
                          <span className="font-mono text-indigo-700 truncate max-w-[200px]">
                            {runs[0].result_json.normalizedBusinessContext?.shopUrl || runs[0].result_json.scannedShopUrl || "-"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-content-muted">{t("monitor_sku_count_label")}</span>
                          <span className="font-mono text-indigo-700">
                            {runs[0].result_json.normalizedBusinessContext?.skuCount ?? runs[0].result_json.scannedSkuCount ?? "-"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-content-muted">{t("delay_threshold_label")}</span>
                          <span className="font-mono text-indigo-700">
                            {runs[0].result_json.normalizedBusinessContext?.alertThresholdHours ?? runs[0].result_json.alertThresholdHours ?? "-"}
                          </span>
                        </div>
                        <div className="flex justify-between pb-2">
                          <span className="text-content-muted">{t("has_notify_channels_label")}</span>
                          <span className="font-mono text-indigo-700">
                            {String(runs[0].result_json.normalizedBusinessContext?.notifyChannelsConfigured ?? runs[0].result_json.notifyChannelsConfigured ?? "-")}
                          </span>
                        </div>
                        {runs[0].result_json.validationSummary && (
                          <div className="flex justify-between pb-2">
                            <span className="text-content-muted">{t("validation_summary_label")}</span>
                            <span className="font-mono text-indigo-700 truncate max-w-[200px]">{runs[0].result_json.validationSummary}</span>
                          </div>
                        )}
                        {runs[0].result_json.completedAt && (
                          <div className="flex justify-between pb-2">
                            <span className="text-content-muted">{t("completed_at_label")}</span>
                            <span className="font-mono text-indigo-700 truncate max-w-[200px]">{new Date(runs[0].result_json.completedAt).toLocaleString(i18n.resolvedLanguage || i18n.language)}</span>
                          </div>
                        )}
                        {runs[0].result_json.generatedSteps && (
                          <div className="pt-2 border-t border-indigo-50/50">
                            <div className="text-content-muted mb-1">{t("generated_steps_label")}:</div>
                            <ul className="list-disc pl-4 space-y-1">
                              {runs[0].result_json.generatedSteps.map((s: string, i: number) => (
                                <li key={i} className="text-content-secondary">{s}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <div className="pt-2 border-t border-indigo-50/50">
                          <div className="text-content-muted mb-1">{t("run_findings_label")}:</div>
                          <ul className="list-disc pl-4 space-y-1">
                            {(runs[0].result_json.findings || runs[0].result_json.simulatedFindings || []).map((f: string, i: number) => (
                              <li key={i} className="text-content-secondary">{f}</li>
                            ))}
                          </ul>
                        </div>
                        {runs[0].result_json.nextActionSuggestions && (
                          <div className="pt-2 border-t border-indigo-50/50">
                            <div className="text-content-muted mb-1">{t("next_action_suggestions_label")}:</div>
                            <ul className="list-disc pl-4 space-y-1">
                              {runs[0].result_json.nextActionSuggestions.map((s: string, i: number) => (
                                <li key={i} className="text-content-secondary">{s}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-content-muted text-center py-2">{t("no_summary_available")}</div>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <h5 className="text-[13px] font-semibold text-content-muted uppercase tracking-wider">{t("recent_runs_label")}</h5>
                  <div className="bg-surface border border-outline rounded-lg divide-y divide-outline">
                    {runs.map((r, i) => (
                      <div key={i} className="flex items-center justify-between p-2 text-[13px]">
                        <span className="text-content-muted">{new Date(r.timestamp).toLocaleString(i18n.resolvedLanguage || i18n.language)}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-content-secondary truncate max-w-[100px]">{r.runType}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium uppercase ${
                            r.status === 'success' ? 'bg-emerald-100 text-emerald-700' :
                            r.status === 'failed' ? 'bg-rose-100 text-rose-700' :
                            'bg-control-hover text-content-secondary'
                          }`}>
                            {String(t(r.status === "success" ? "run_status_success" : r.status === "failed" ? "run_status_failed" : "run_status_unknown"))}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </Card>
      )}

      {mode === "generic" ? (
        <Card className="p-4 bg-surface-muted border-outline">
          <div className="flex items-start gap-3">
            <Info className="w-4 h-4 text-content-muted mt-0.5 shrink-0" />
            <div className="text-sm text-content-secondary">
              <p className="font-medium text-content mb-1">{t("context_generic_mode")}</p>
              <p>{t("context_generic_desc")}</p>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden border-outline">
          <div className="bg-surface-muted px-4 py-3 border-b border-outline flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-content-muted" />
              <h4 className="text-sm font-semibold text-content">{t("context_summary_title")}</h4>
            </div>
            <div className="text-[13px] font-medium px-2 py-1 bg-surface border border-outline rounded text-content-secondary">
              {t("context_progress", {
                completed: summary.completedRequiredCount, 
                total: summary.totalRequiredCount 
              })}
            </div>
          </div>
          <div className="p-4 bg-surface grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Object.entries(businessContext).map(([key, value]) => {
              // Convert array to string for display
              let displayValue = value;
              if (Array.isArray(value)) {
                displayValue = value.length > 0 ? value.join(", ") : "[]";
              } else if (typeof value === 'boolean') {
                displayValue = value ? t("yes_value") : t("no_value");
              } else if (value === null || value === undefined || value === "") {
                displayValue = "-";
              }

              return (
                <div key={key} className="flex flex-col gap-1">
                  <span className="text-[13px] font-medium text-content-muted uppercase tracking-wider">{key}</span>
                  <span className="text-sm text-content font-mono truncate bg-surface-muted px-2 py-1 rounded border border-outline">
                    {String(displayValue)}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
