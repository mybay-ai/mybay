import React, { useEffect, useState } from "react";
import { 
  Activity, ShieldCheck, Box, Users, Cpu, HardDrive, 
  ArrowRight, Zap, AlertCircle, Network, Globe, Signal, 
  CheckCircle2, Server, ServerCrash, RotateCw, AlertTriangle, 
  Rocket, Play, ChevronRight, Layout, History, 
  Settings, CreditCard, ShieldAlert, Sparkles, Compass,
  FileText, Download, Eye, Terminal
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { OverviewStats, AgentInstance } from "../types";
import { Card, Button, cn } from "./ui";
import { getRefinedStatusLabel } from "./dashboard/instanceStatus";
import { APP_ROUTES } from "../constants/routes";
import { api } from "../lib/api";
import { resolveBlueprintCardContent, resolveWorkflowCardContent, getRiskLevelTranslationKey } from "./template-center/utils";
import type { WorkflowTemplate, IndustryBlueprint } from "./template-center/types";

type AuditTranslator = (key: string, options?: Record<string, unknown>) => string;

const AUDIT_DETAIL_TRANSLATION_KEYS: Record<string, string> = {
  "User triggered manual restart container": "overview.audit.details.manual_restart_container",
  "Performed restart action": "overview.audit.details.restart_action",
  "User triggered manual stop container": "overview.audit.details.manual_stop_container",
  "Performed stop action": "overview.audit.details.stop_action",
  "User triggered manual start container": "overview.audit.details.manual_start_container",
  "Performed start action": "overview.audit.details.start_action",
  "Created instance": "overview.audit.details.created_instance",
  "Instance created": "overview.audit.details.created_instance",
  "Created new instance": "overview.audit.details.created_new_instance",
  "Started instance": "overview.audit.details.started_instance",
  "Stopped instance": "overview.audit.details.stopped_instance",
  "Restarted instance": "overview.audit.details.restarted_instance",
  "Archived instance (kept configuration)": "overview.audit.details.archived_instance",
  "Deleted instance permanently": "overview.audit.details.deleted_instance_permanently",
  "Upgrade started": "overview.audit.details.upgrade_started",
  "Upgrade completed": "overview.audit.details.upgrade_completed",
  "Upgrade failed": "overview.audit.details.upgrade_failed",
  "Rebuild proxy mapping": "overview.audit.details.rebuilt_proxy_mapping",
  "Rebuilt proxy mapping": "overview.audit.details.rebuilt_proxy_mapping",
  "None": "overview.audit.details.none",
};

const AUDIT_ACTION_TRANSLATION_KEYS: Record<string, string> = {
  create: "overview.audit.actions.create",
  start: "overview.audit.actions.start",
  stop: "overview.audit.actions.stop",
  restart: "overview.audit.actions.restart",
  restart_container: "overview.audit.actions.restart",
  stop_container: "overview.audit.actions.stop",
  rebuild_proxy: "overview.audit.actions.rebuild_proxy",
  redeploy: "overview.audit.actions.redeploy",
  restore: "overview.audit.actions.restore",
  archive: "overview.audit.actions.archive",
  delete: "overview.audit.actions.delete",
  task_complete: "overview.audit.actions.task_complete",
};

const PREVIEW_BACKUP_PREFIX = "Previewed backup package of instance:";

const translateLogDetails = (details: string | null, t: AuditTranslator) => {
  if (!details) return "";
  const trimmed = details.trim();

  if (trimmed.startsWith(PREVIEW_BACKUP_PREFIX)) {
    const instanceName = trimmed.slice(PREVIEW_BACKUP_PREFIX.length).trim();
    return t("overview.audit.details.previewed_backup_package", {
      instance: instanceName || t("overview.audit.unknown_instance"),
    });
  }

  const key = AUDIT_DETAIL_TRANSLATION_KEYS[trimmed];
  return key ? t(key) : trimmed;
};

const translateLogAction = (action: string | null, t: AuditTranslator) => {
  if (!action) return "";
  const trimmed = action.trim();
  const key = AUDIT_ACTION_TRANSLATION_KEYS[trimmed];
  return key ? t(key) : trimmed;
};

const safeParseAuditDetails = (details: unknown): Record<string, unknown> | null => {
  if (!details) return null;
  if (typeof details === "object" && details !== null) {
    return details as Record<string, unknown>;
  }
  if (typeof details === "string") {
    const trimmed = details.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Not a valid JSON, fallback to non-JSON parsing
    }
  }
  return null;
};

const formatAuditLogTitle = (log: any, t: any): string => {
  const parsed = safeParseAuditDetails(log.details);

  if (!parsed) {
    // Non-JSON string details, fallback and truncate to 80 characters
    let title = translateLogDetails(log.details, t) || translateLogAction(log.action, t);
    if (title && title.length > 80) {
      return title.substring(0, 80) + "...";
    }
    return title;
  }

  const { action } = log;
  const status = parsed.status;
  const skillId = parsed.skillId;

  // Check if status is success/complete
  const isSuccess = status === "completed" || status === "complete" || status === "success" || status === "ok";

  if (action === "chat_workspace_message") {
    return t(isSuccess ? "overview.audit.chat.messageSuccess" : "overview.audit.chat.messageFailed");
  }

  if (action === "chat_workspace_multiturn") {
    return t(isSuccess ? "overview.audit.chat.multiturnSuccess" : "overview.audit.chat.multiturnFailed");
  }

  if (action === "chat_workspace_assist") {
    const skillTranslationKeys: Record<string, string> = {
      model_config_diagnosis: "overview.audit.assist.skills.modelConfigDiagnosis",
      explain_last_error: "overview.audit.assist.skills.explainLastError",
      instance_health_summary: "overview.audit.assist.skills.instanceHealthSummary",
      summarize_conversation: "overview.audit.assist.skills.summarizeConversation",
    };
    const skillIdStr = typeof skillId === "string" ? skillId : "";
    const skillKey = skillTranslationKeys[skillIdStr];
    const skillName = skillKey ? t(skillKey) : skillIdStr;
    return t(isSuccess ? "overview.audit.assist.completed" : "overview.audit.assist.failed", { skill: skillName });
  }

  // Fallback for other JSON detail actions if any
  // Filter out technical fields (conversationId, timestamp, messagesCount, promptLength)
  const filteredKeys = Object.keys(parsed).filter(
    (key) => !["conversationId", "timestamp", "messagesCount", "promptLength"].includes(key)
  );

  if (filteredKeys.length > 0) {
    const parts = filteredKeys.map((k) => `${k}: ${parsed[k]}`).join(", ");
    let title = `${translateLogAction(action, t)} (${parts})`;
    if (title.length > 80) {
      return title.substring(0, 80) + "...";
    }
    return title;
  }

  let finalTitle = translateLogAction(action, t);
  if (finalTitle.length > 80) {
    return finalTitle.substring(0, 80) + "...";
  }
  return finalTitle;
};

export interface OverviewSectionProps {
  currentUser: any;
  onTabChange: (tab: string) => void;
  instances: AgentInstance[];
}

export function OverviewSection({ currentUser, onTabChange, instances }: OverviewSectionProps) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation("dashboard");

  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [adminOverview, setAdminOverview] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [adminStatsError, setAdminStatsError] = useState(false);
  const [credentialsCount, setCredentialsCount] = useState<number>(0);
  const [resourcePolicy, setResourcePolicy] = useState<any>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [recentOutputs, setRecentOutputs] = useState<any[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowTemplate[]>([]);
  const [blueprints, setBlueprints] = useState<IndustryBlueprint[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [recentTasks24h, setRecentTasks24h] = useState<number | null | 'loading' | 'error'>('loading');

  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'super_admin';

  useEffect(() => {
    let intervalId: any;

    const fetchDashboardSummary = async () => {
      try {
        setTemplatesLoading(true);
        const data = await api.get('/api/system/my-dashboard-summary');
        if (data) {
          // Set Usage Summary / Stats
          if (data.usageSummary) {
            const usageData = data.usageSummary;
            const limitMb = usageData.storageLimitMb;
            const usedMb = usageData.storageUsedMb;
            
            const storageUnlimited = limitMb === null;
            const storageUsageAggregated = usedMb !== null;

            setStats({
              totalInstances: usageData.instanceLimit,
              runningInstances: usageData.runningInstances,
              stoppedInstances: usageData.instanceUsed - usageData.runningInstances,
              deployingInstances: 0,
              cpuUsage: 0,
              memUsed: usedMb === null ? null : usedMb * 1024 * 1024,
              memTotal: limitMb === null ? null : limitMb * 1024 * 1024,
              diskUsed: 0,
              diskTotal: 0,
              storageUnlimited,
              storageUsageAggregated
            } as any);
          }

          // Set Credentials Count
          if (typeof data.credentialsCount === 'number') {
            setCredentialsCount(data.credentialsCount);
          }

          // Set Policy
          if (data.resourcePolicy) {
            setResourcePolicy(data.resourcePolicy);
          }

          // Set Audit Logs
          if (data.auditLogs) {
            setAuditLogs(data.auditLogs);
          }

          // Set 24H task count
          if (typeof data.recentTasks24h === 'number') {
            setRecentTasks24h(data.recentTasks24h);
          } else {
            setRecentTasks24h('error');
          }

          // Set Recent Outputs
          if (Array.isArray(data.recentOutputs)) {
            setRecentOutputs(data.recentOutputs);
          }

          // Set Templates / Blueprints
          if (Array.isArray(data.recommendedWorkflows)) {
            setWorkflows(data.recommendedWorkflows);
          }
          if (Array.isArray(data.recommendedBlueprints)) {
            setBlueprints(data.recommendedBlueprints);
          }
        }
      } catch (err) {
        console.error("Failed to fetch dashboard summary", err);
        setRecentTasks24h('error');
      } finally {
        setLoading(false);
        setTemplatesLoading(false);
      }
    };

    const fetchAdminData = async () => {
      try {
        const data = await api.get('/api/system/admin/overview');
        if (data) {
          setAdminOverview(data);
          setAdminStatsError(false);
          setStats({
            totalInstances: data.instances.total,
            runningInstances: data.instances.running,
            stoppedInstances: data.instances.stopped,
            deployingInstances: 0,
            activeUsers: 0,
            cpuUsage: data.system.cpuPercent,
            memUsed: data.system.memoryUsedMb * 1024 * 1024,
            memTotal: data.system.memoryTotalMb * 1024 * 1024,
            diskUsed: data.system.diskUsedGb * 1024 * 1024 * 1024,
            diskTotal: data.system.diskTotalGb * 1024 * 1024 * 1024
          } as any);
        } else {
          setAdminStatsError(true);
        }
      } catch (err) {
        console.error("Failed to fetch admin stats", err);
        setAdminStatsError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardSummary();

    return () => clearInterval(intervalId);
  }, [currentUser, instances]);

  const activeInstances = instances.filter(i => !i.archived);
  const runningCount = activeInstances.filter(i => i.status === 'running' || i.status === 'partial_running').length;
  const errorCount = activeInstances.filter(i => i.status === 'failed' || i.physical_status === 'error').length;
  const stoppedCount = activeInstances.filter(i => i.status === 'stopped' || i.archived).length;
  const startingCount = activeInstances.filter(i => ['deploying', 'starting', 'restarting', 'gateway_starting'].includes(i.status)).length;

  // Global State Determinant
  const getGlobalState = () => {
    if (instances.length === 0) return 'no_instance';
    if (errorCount > 0) return 'attention_required';
    if (startingCount > 0) return 'starting';
    if (runningCount > 0) return 'running';
    if (stoppedCount > 0) return 'stopped';
    return 'stopped';
  };

  const globalState = getGlobalState();

  const attentionItems = [];
  if (errorCount > 0) {
    attentionItems.push({
      id: 'error',
      icon: AlertCircle,
      color: 'text-red-600 bg-red-50',
      title: t("overview.attention.error.title"),
      desc: t("overview.attention.error.desc", { count: errorCount }),
      btn: t("overview.attention.error.btn"),
      action: () => onTabChange('instances')
    });
  }
  if (credentialsCount === 0 && instances.length > 0) {
    attentionItems.push({
      id: 'model',
      icon: ShieldAlert,
      color: 'text-amber-600 bg-amber-50',
      title: t("overview.attention.model.title"),
      desc: t("overview.attention.model.desc"),
      btn: t("overview.attention.model.btn"),
      action: () => onTabChange('credentials')
    });
  }
  if (stoppedCount > 0 && runningCount === 0 && instances.length > 0) {
    attentionItems.push({
      id: 'stopped',
      icon: Play,
      color: 'text-blue-600 bg-blue-50',
      title: t("overview.attention.stopped.title"),
      desc: t("overview.attention.stopped.desc"),
      btn: t("overview.attention.stopped.btn"),
      action: () => onTabChange('instances')
    });
  }

  const StatCard = ({ title, value, icon: Icon, color, subValue, trend }: any) => (
    <Card className="p-6 border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-indigo-100 dark:hover:border-indigo-800/80 transition-all duration-300 shadow-sm hover:shadow-md rounded-2xl group flex flex-col justify-between h-full">
      <div className="flex justify-between items-start gap-4">
        <div className="space-y-1.5">
          <p className="text-slate-500 dark:text-slate-400 text-sm font-bold tracking-wide">{title}</p>
          <div className="flex items-baseline gap-2">
            <h3 className="text-3xl font-black text-slate-900 dark:text-slate-100 tracking-tight">{loading ? "..." : value}</h3>
            {trend && <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-md">{trend}</span>}
          </div>
          {subValue && <p className="text-slate-500 dark:text-slate-400 text-sm mt-2 font-medium leading-relaxed">{subValue}</p>}
        </div>
        <div className={cn("p-3 rounded-xl transition-all duration-300", color, "bg-opacity-10 dark:bg-opacity-20 text-opacity-100 group-hover:scale-110")}>
          <Icon className={cn("w-6 h-6", color.replace('bg-', 'text-'))} />
        </div>
      </div>
    </Card>
  );

  let recentTasksValue: string = "...";
  if (recentTasks24h === 'loading') {
    recentTasksValue = "...";
  } else if (recentTasks24h === 'error') {
    recentTasksValue = "--";
  } else if (typeof recentTasks24h === 'number') {
    recentTasksValue = String(recentTasks24h);
  }

  return (
    <div className="space-y-6 md:space-y-8 animate-in fade-in duration-500">
      
      {/* Workbench Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-100 dark:border-slate-800">
        <div>
          <h2 className="text-3xl font-black tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
            <Sparkles className="w-7 h-7 text-indigo-500 animate-pulse" />
            {t("overview.workbench_title")}
          </h2>
          <p className="text-base font-medium text-slate-500 dark:text-slate-400 mt-2">
            {t("overview.workbench_subtitle")}
          </p>
        </div>
        
        {/* Real-time status indicator */}
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-xl border border-slate-200/50">
          <span className={cn(
            "inline-flex w-2.5 h-2.5 rounded-full",
            globalState === 'running' ? "bg-emerald-500" :
            globalState === 'starting' ? "bg-blue-500 animate-pulse" :
            globalState === 'attention_required' ? "bg-red-500" : "bg-slate-400"
          )} />
          <span className="text-sm font-bold text-slate-600 uppercase tracking-wider">
            {globalState === 'running' ? t("status_running") :
             globalState === 'starting' ? t("status_starting") :
             globalState === 'attention_required' ? t("status_attention") :
             t("status_stopped")}
          </span>
        </div>
      </div>

      {/* Dual-Track Actions Section (Quick Start) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Track A: From Template (模板中心前置) */}
        <Card className="p-6 border-slate-100 shadow-sm bg-gradient-to-br from-indigo-50/50 via-white to-white hover:border-indigo-200 transition-all group relative overflow-hidden rounded-2xl">
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 blur-2xl -translate-y-1/2 translate-x-1/3" />
          
          <div className="space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="p-3 bg-indigo-500/10 rounded-xl text-indigo-600 group-hover:scale-110 transition-transform">
                <Compass className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-black text-slate-900 text-xl">{t("overview.start_from_template")}</h3>
                <p className="text-sm font-medium text-slate-500 mt-1">{t("overview.start_from_template_desc")}</p>
              </div>
            </div>

            {/* Micro Templates Preview inside Card */}
            <div className="space-y-2 pt-2">
              {templatesLoading ? (
                <div className="h-14 bg-slate-50/50 rounded-xl animate-pulse border border-slate-100" />
              ) : blueprints.length > 0 ? (
                blueprints.slice(0, 2).map((bp) => (
                  <div key={bp.id} className="p-3 bg-slate-50/50 hover:bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-between gap-4 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-1.5 rounded-lg bg-white border border-slate-100 text-indigo-500 shrink-0">
                        <Layout className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">
                          {bp.name}
                        </p>
                        <p className="text-xs text-slate-500 truncate mt-1">
                          {bp.description}
                        </p>
                      </div>
                    </div>
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => navigate(`${APP_ROUTES.DEPLOY}?template_type=blueprint&blueprint_id=${bp.id}`)}
                      className="h-8 text-xs font-bold px-3 shrink-0 rounded-lg bg-white border-slate-200 hover:bg-slate-50 text-indigo-600 border-indigo-100 hover:border-indigo-200"
                    >
                      {t("overview.action_deploy")}
                    </Button>
                  </div>
                ))
              ) : (
                workflows.slice(0, 2).map((wf) => (
                  <div key={wf.id} className="p-3 bg-slate-50/50 hover:bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-between gap-4 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-1.5 rounded-lg bg-white border border-slate-100 text-emerald-500 shrink-0">
                        <Terminal className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">
                          {wf.name}
                        </p>
                        <p className="text-xs text-slate-500 truncate mt-1">
                          {wf.description}
                        </p>
                      </div>
                    </div>
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => navigate(`${APP_ROUTES.DEPLOY}?template_type=workflow&template_id=${wf.id}`)}
                      className="h-8 text-xs font-bold px-3 shrink-0 rounded-lg bg-white border-slate-200 hover:bg-slate-50 text-indigo-600 border-indigo-100 hover:border-indigo-200"
                    >
                      {t("overview.action_deploy")}
                    </Button>
                  </div>
                ))
              )}
            </div>

            <Button 
              onClick={() => navigate(APP_ROUTES.TEMPLATES)}
              className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              {t("overview.view_all_templates")}
            </Button>
          </div>
        </Card>

        {/* Track B: Custom Deploy & Demo Experience */}
        <Card className="p-6 border-slate-100 dark:border-emerald-500/10 shadow-sm bg-gradient-to-br from-emerald-50/30 via-white to-white dark:from-emerald-950/20 dark:via-slate-900/60 dark:to-slate-900 hover:border-emerald-200 dark:hover:border-emerald-500/30 transition-all group relative overflow-hidden rounded-2xl">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 blur-2xl -translate-y-1/2 translate-x-1/3" />
          
          <div className="space-y-4 flex flex-col justify-between h-full">
            <div className="space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="p-3 bg-emerald-500/10 dark:bg-emerald-500/20 rounded-xl text-emerald-600 dark:text-emerald-400 group-hover:scale-110 transition-transform">
                  <Rocket className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-black text-slate-900 dark:text-slate-50 text-xl">{t("overview.custom_deploy")}</h3>
                  <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mt-1">{t("overview.custom_deploy_desc")}</p>
                </div>
              </div>

              {/* Sandbox Demo Area */}
              <div className="p-4 bg-emerald-50/30 dark:bg-emerald-950/30 border border-emerald-100/50 dark:border-emerald-500/20 rounded-xl space-y-2 mt-2">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">{t("overview.experience_demo")}</span>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  {t("overview.experience_demo_desc")}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <Button 
                variant="outline"
                onClick={() => navigate('/demo')}
                className="h-11 border-emerald-100 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50/50 dark:hover:bg-emerald-500/10 font-bold rounded-xl transition-all"
              >
                <Play className="w-4 h-4 mr-2" />
                {t("overview.action_go_demo")}
              </Button>
              
              <Button 
                onClick={() => navigate(APP_ROUTES.DEPLOY)}
                className="h-11 bg-slate-950 hover:bg-slate-900 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white font-bold rounded-xl transition-all shadow-sm"
              >
                <Zap className="w-4 h-4 mr-2" />
                {t("overview.action_new_deploy")}
              </Button>
            </div>
          </div>
        </Card>

      </div>

      {/* Recommended Solutions & Workflows Center */}
      <section className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <h4 className="font-black text-slate-900 flex items-center gap-2 text-xl">
            <Compass className="w-6 h-6 text-indigo-500 animate-pulse" />
            {t("overview.recommend_templates")}
          </h4>
          <Button variant="ghost" size="sm" onClick={() => navigate(APP_ROUTES.TEMPLATES)} className="text-sm font-bold text-indigo-600 hover:text-indigo-700">
            {t("overview.view_all_templates")} <ChevronRight className="w-5 h-5 ml-1" />
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Blueprints Column */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h5 className="font-black text-slate-900 text-lg flex items-center gap-2">
                <Layout className="w-5 h-5 text-indigo-500" />
                {t("template_center.tab_solutions")}
              </h5>
            </div>
            
            <div className="space-y-4">
              {templatesLoading ? (
                [1, 2].map((n) => (
                  <div key={n} className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3 animate-pulse h-48" />
                ))
              ) : blueprints.length === 0 ? (
                <div className="text-center py-8 bg-slate-50/50 rounded-2xl border border-slate-100 text-slate-400 text-xs font-medium">
                  {t("template_center.not_found_solutions")}
                </div>
              ) : (
                blueprints.slice(0, 2).map((bp) => {
                  const cardContent = resolveBlueprintCardContent(bp, t);
                  return (
                    <Card key={bp.id} className="p-5 border-slate-100 hover:border-slate-200/80 shadow-sm hover:shadow-md transition-all bg-white rounded-2xl flex flex-col justify-between h-full relative overflow-hidden group text-left">
                      <div className="space-y-3">
                        <div className="flex justify-between items-start">
                          <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 text-xs font-bold rounded-md uppercase tracking-wider">
                            {t("template_center.version_label")} {bp.version}
                          </span>
                        </div>
                        
                        <div>
                          <h6 className="font-bold text-slate-900 text-base group-hover:text-indigo-600 transition-colors">
                            {bp.name}
                          </h6>
                          <p className="text-sm text-slate-500 mt-1.5 leading-relaxed line-clamp-2">
                            {bp.description}
                          </p>
                        </div>

                        {cardContent.targetAudience && (
                          <div className="text-xs text-slate-600 font-medium leading-relaxed flex items-center gap-1.5 mt-2">
                            <span className="text-slate-400 font-semibold shrink-0">🎯 {t("template_center.target_audience_label")}:</span>
                            <span className="truncate">{cardContent.targetAudience}</span>
                          </div>
                        )}
                      </div>
                      
                      <div className="mt-4 pt-3 border-t border-slate-50 flex gap-2 justify-end">
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => navigate(`${APP_ROUTES.TEMPLATES}?tab=industry&blueprint_id=${bp.id}`)}
                          className="text-xs font-bold text-slate-500 hover:text-slate-800"
                        >
                          {t("template_center.btn_details")}
                        </Button>
                        <Button 
                          onClick={() => navigate(`${APP_ROUTES.DEPLOY}?template_type=blueprint&blueprint_id=${bp.id}`)}
                          className="h-8 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl px-3 transition-all"
                        >
                          {t("template_center.btn_deploy_blueprint")}
                        </Button>
                      </div>
                    </Card>
                  );
                })
              )}
            </div>
          </div>

          {/* Workflows Column */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h5 className="font-black text-slate-900 text-lg flex items-center gap-2">
                <Terminal className="w-5 h-5 text-emerald-500" />
                {t("template_center.tab_workflows")}
              </h5>
            </div>

            <div className="space-y-4">
              {templatesLoading ? (
                [1, 2].map((n) => (
                  <div key={n} className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3 animate-pulse h-48" />
                ))
              ) : workflows.length === 0 ? (
                <div className="text-center py-8 bg-slate-50/50 rounded-2xl border border-slate-100 text-slate-400 text-xs font-medium">
                  {t("template_center.not_found_workflows")}
                </div>
              ) : (
                workflows.slice(0, 2).map((wf) => {
                  const cardContent = resolveWorkflowCardContent(wf, t);
                  return (
                    <Card key={wf.id} className="p-5 border-slate-100 hover:border-slate-200/80 shadow-sm hover:shadow-md transition-all bg-white rounded-2xl flex flex-col justify-between h-full relative overflow-hidden group text-left">
                      <div className="space-y-3">
                        <div className="flex justify-between items-start">
                          <span className="px-2.5 py-1 bg-amber-50 text-amber-700 text-xs font-bold rounded-md uppercase tracking-wider">
                            {t("template_center.risk_label")}: {t(getRiskLevelTranslationKey(wf.risk_level))}
                          </span>
                        </div>
                        
                        <div>
                          <h6 className="font-bold text-slate-900 text-base group-hover:text-indigo-600 transition-colors">
                            {wf.name}
                          </h6>
                          <p className="text-sm text-slate-500 mt-1.5 leading-relaxed line-clamp-2">
                            {wf.description}
                          </p>
                        </div>

                        {cardContent.automationResultPreview && (
                          <div className="text-xs text-slate-600 font-medium leading-relaxed flex items-center gap-1.5 mt-2">
                            <span className="text-emerald-600 font-semibold shrink-0">💰 {t("template_center.business_value_label")}:</span>
                            <span className="truncate">{cardContent.automationResultPreview}</span>
                          </div>
                        )}
                      </div>
                      
                      <div className="mt-4 pt-3 border-t border-slate-50 flex gap-2 justify-end">
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => navigate(`${APP_ROUTES.TEMPLATES}?tab=workflow&workflow_id=${wf.id}`)}
                          className="text-xs font-bold text-slate-500 hover:text-slate-800"
                        >
                          {t("template_center.btn_details")}
                        </Button>
                        <Button 
                          onClick={() => navigate(`${APP_ROUTES.DEPLOY}?template_type=workflow&template_id=${wf.id}`)}
                          className="h-8 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl px-3 transition-all"
                        >
                          {t("template_center.btn_use_workflow")}
                        </Button>
                      </div>
                    </Card>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Core Indicating Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <StatCard 
          title={t("overview.stat_running_agents")} 
          value={`${runningCount} / ${activeInstances.length}`} 
          icon={Box} 
          color="bg-blue-500" 
          subValue={t("overview.stat_running_agents_desc")}
        />
        <StatCard 
          title={t("overview.stat_attention_needed")} 
          value={t("overview.stat_attention_items_count", { count: attentionItems.length })} 
          icon={AlertCircle} 
          color={attentionItems.length > 0 ? "bg-amber-500" : "bg-slate-400"}
          subValue={t("overview.stat_attention_needed_desc")}
        />
        <StatCard 
          title={t("overview.stat_recent_tasks")} 
          value={recentTasksValue} 
          icon={Zap} 
          color="bg-indigo-500"
          subValue={t("overview.stat_recent_tasks_desc")}
        />
        <StatCard 
          title={t("overview.stat_quota_usage")} 
          value={`${activeInstances.length} / ${stats?.totalInstances || 1}`} 
          icon={Layout} 
          color="bg-slate-600"
          subValue={t("overview.stat_quota_usage_desc")}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 md:gap-8">
        
        {/* Left Column: Recent Tasks (Timeline) & Recent Outputs (Files) */}
        <div className="xl:col-span-2 space-y-6 md:space-y-8">
          
          {/* Recent Outputs (Generated Files) */}
          <section>
            <div className="flex items-center justify-between mb-4 px-1">
              <h4 className="font-black text-slate-900 flex items-center gap-2 text-xl">
                <FileText className="w-6 h-6 text-indigo-500" />
                {t("overview.recent_outputs")}
              </h4>
              {recentOutputs.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => onTabChange('instances')} className="text-sm font-bold text-blue-600 hover:text-blue-700">
                  {t("overview.browse_files")} <ChevronRight className="w-5 h-5 ml-1" />
                </Button>
              )}
            </div>
            
            <Card className="p-5 border-slate-100 shadow-sm bg-white rounded-2xl">
              {recentOutputs.length === 0 ? (
                <div className="py-10 text-center flex flex-col items-center">
                  <div className="p-3 bg-slate-50 rounded-full mb-3 text-slate-300">
                    <FileText className="w-8 h-8" />
                  </div>
                  <p className="text-sm font-bold text-slate-600 mb-2">{t("overview.no_outputs")}</p>
                  <p className="text-sm text-slate-500 max-w-sm leading-relaxed">
                    {t("overview.recent_outputs_desc")}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {recentOutputs.map((file, idx) => (
                    <div key={idx} className="py-3 flex items-center justify-between gap-4 first:pt-0 last:pb-0 group">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 bg-indigo-50 text-indigo-500 rounded-xl border border-indigo-100/50">
                          <FileText className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-800 truncate group-hover:text-indigo-600 transition-colors" title={file.name}>
                            {file.name}
                          </p>
                          <p className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                            <span>{file.instanceName}</span>
                            <span>•</span>
                            <span>{(file.size / 1024).toFixed(1)} KB</span>
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          onClick={() => window.open(`/api/instances/${file.instanceId}/files/download?path=${encodeURIComponent(file.path)}`, "_blank")}
                          className="h-8 w-8 p-0 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-50"
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </section>

          {/* Recent Activity Timeline */}
          <section>
            <div className="flex items-center justify-between mb-4 px-1">
              <h4 className="font-black text-slate-900 flex items-center gap-2 text-xl">
                <History className="w-6 h-6 text-indigo-500" />
                {t("overview.recent_tasks")}
              </h4>
              <Button variant="ghost" size="sm" onClick={() => onTabChange('tasks')} className="text-sm font-bold text-blue-600 hover:text-blue-700">
                {t("nav.tasks")} <ChevronRight className="w-5 h-5 ml-1" />
              </Button>
            </div>
            
            <Card className="p-6 border-slate-100 dark:border-slate-800 shadow-sm bg-white dark:bg-slate-900 rounded-2xl">
              {auditLogs.length === 0 ? (
                <div className="py-10 text-center flex flex-col items-center">
                  <Activity className="w-8 h-8 text-slate-200 dark:text-slate-700 mb-3" />
                  <p className="text-sm font-bold text-slate-600 dark:text-slate-400 mb-2">{t("overview.no_tasks")}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-500 max-w-sm leading-relaxed">
                    {t("overview.no_tasks_desc")}
                  </p>
                </div>
              ) : (
                <div className="relative space-y-6 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[1.5px] before:bg-slate-100 dark:before:bg-slate-800">
                  {auditLogs.map((log, idx) => (
                    <div key={idx} className="relative pl-8 flex flex-col gap-1 group min-w-0">
                      <div className={cn(
                        "absolute left-0 top-1.5 w-[24px] h-[24px] rounded-full border-2 border-white dark:border-slate-900 flex items-center justify-center z-10 shadow-sm transition-transform group-hover:scale-110 shrink-0",
                        log.action === 'create' ? 'bg-blue-500' : 
                        log.action === 'start' ? 'bg-emerald-500' : 
                        log.action === 'task_complete' ? 'bg-indigo-500' : 'bg-slate-400'
                      )}>
                        <div className="w-1.5 h-1.5 rounded-full bg-white" />
                      </div>
                      <div className="flex justify-between items-start gap-4 min-w-0">
                        <p className="text-sm font-bold text-slate-800 dark:text-slate-200 leading-tight min-w-0 flex-1 break-words line-clamp-2">
                          {formatAuditLogTitle(log, t)}
                        </p>
                        <time className="text-xs text-slate-500 dark:text-slate-400 font-medium whitespace-nowrap tabular-nums mt-0.5 shrink-0">
                          {new Date(log.timestamp).toLocaleTimeString(i18n.resolvedLanguage || i18n.language, { hour: '2-digit', minute: '2-digit' })}
                        </time>
                      </div>
                      {log.instance_id && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mt-1.5 min-w-0">
                          <Box className="w-2.5 h-2.5 shrink-0" />
                          <span className="truncate">{log.instance_name || t("overview.audit.instance_id", { id: log.instance_id })}</span>
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </section>

        </div>

        {/* Right Column: Instance Overview, Channel Status & System status summary */}
        <div className="space-y-6 md:space-y-8">
          
          {/* My Agent Instances Overview */}
          <section>
            <div className="flex items-center justify-between mb-4 px-1">
              <h4 className="font-black text-slate-900 flex items-center gap-2 text-xl">
                <Box className="w-6 h-6 text-indigo-500" />
                {t("overview.instance_overview")}
              </h4>
              <Button variant="ghost" size="sm" onClick={() => onTabChange('instances')} className="text-sm font-bold text-blue-600 hover:text-blue-700">
                {t("nav.instances")} <ChevronRight className="w-5 h-5 ml-1" />
              </Button>
            </div>
            
            {instances.length === 0 ? (
              <Card className="p-6 border-slate-100 shadow-sm bg-white rounded-2xl text-center flex flex-col items-center">
                <Box className="w-8 h-8 text-slate-300 mb-3" />
                <p className="text-sm font-bold text-slate-600">{t("overview.no_instances_fallback")}</p>
              </Card>
            ) : (
              <div className="space-y-3">
                {instances.slice(0, 3).map((inst) => {
                  const label = getRefinedStatusLabel(inst);
                  const summary = inst.configSummary || {};
                  
                  return (
                    <Card key={inst.id} className="p-4 border-slate-100 shadow-sm bg-white rounded-2xl hover:border-indigo-100 transition-colors">
                      <div className="flex justify-between items-start gap-2 mb-2">
                        <p className="text-sm font-bold text-slate-900 truncate" title={inst.name}>{inst.name}</p>
                        <span className={cn(
                          "px-2.5 py-0.5 rounded-full text-xs font-bold border shrink-0",
                          label.textClass
                        )}>
                          {label.i18nKey ? t(label.i18nKey) : label.text}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-xs mt-3">
                        <div className="bg-slate-50 p-2.5 rounded-xl">
                          <span className="text-slate-500 block mb-1">{t("overview.model")}</span>
                          <span className="text-slate-800 font-bold truncate block">{summary.model || inst.model_name || t("overview.not_set")}</span>
                        </div>
                        <div className="bg-slate-50 p-2.5 rounded-xl">
                          <span className="text-slate-500 block mb-1">{t("overview.channel")}</span>
                          <span className="text-slate-800 font-bold truncate block capitalize">{summary.channelLabel || summary.channel || t("overview.local_terminal")}</span>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>

          {/* Attention Items */}
          {attentionItems.length > 0 && (
            <section>
              <h4 className="font-black text-slate-900 mb-4 flex items-center gap-2 px-1 text-xl">
                <ShieldAlert className="w-6 h-6 text-amber-500" />
                {t("overview.attention_title")}
              </h4>
              <div className="space-y-3">
                {attentionItems.map((item) => {
                  const itemStyles = item.id === 'error' 
                    ? "border-red-100 bg-red-50/20" 
                    : item.id === 'stopped' 
                    ? "border-blue-100 bg-blue-50/20" 
                    : "border-amber-100 bg-amber-50/20";
                  return (
                    <Card key={item.id} className={cn("p-4 border shadow-sm rounded-2xl flex items-start gap-4 animate-in slide-in-from-right duration-300", itemStyles)}>
                      <div className={cn("p-2 rounded-xl shrink-0 bg-white border border-slate-100/80 shadow-sm", item.color.split(' ')[0])}>
                        <item.icon className="w-4 h-4" />
                      </div>
                      <div className="space-y-2.5 flex-1">
                        <div>
                          <h5 className="text-sm font-bold text-slate-900">{item.title}</h5>
                          <p className="text-sm text-slate-600 leading-relaxed mt-1">{item.desc}</p>
                        </div>
                        <Button size="sm" onClick={item.action} variant="primary" className="mt-1 h-9 rounded-xl px-4 text-xs font-bold">
                          {item.btn}
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
          )}

          {/* Channel Integration Status */}
          <section>
            <h4 className="font-black text-slate-900 mb-4 flex items-center gap-2 px-1 text-xl">
              <Network className="w-6 h-6 text-indigo-500" />
              {t("overview.channel_status")}
            </h4>
            
            <Card className="p-4 border-slate-100 shadow-sm bg-white rounded-2xl space-y-3">
              {(() => {
                const targetInstance = activeInstances.find(i => i.status === 'running') || instances[0];
                const summary = targetInstance?.configSummary || {};
                const hasModel = !!summary.model;
                const hasChannel = summary.configuredChannels && summary.configuredChannels.length > 0;
                const hasGateway = !!targetInstance?.url;
                
                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 bg-slate-50/50 border border-slate-100 rounded-xl">
                      <div className="flex items-center gap-2">
                        <div className={cn("w-2 h-2 rounded-full", hasModel ? "bg-emerald-500" : "bg-amber-500")} />
                        <span className="text-sm font-bold text-slate-700">{t("overview.channel_ai_service")}</span>
                      </div>
                      <span className="text-xs font-bold text-slate-500">
                        {summary.model || t("overview.channel_unconfigured")}
                      </span>
                    </div>
                    
                    <div className="flex items-center justify-between p-3 bg-slate-50/50 border border-slate-100 rounded-xl">
                      <div className="flex items-center gap-2">
                        <div className={cn("w-2 h-2 rounded-full", hasChannel ? "bg-emerald-500" : "bg-slate-300")} />
                        <span className="text-sm font-bold text-slate-700">{t("overview.channel_message_gateway")}</span>
                      </div>
                      <span className="text-xs font-bold text-slate-500">
                        {summary.channelLabel || t("overview.channel_inactive")}
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-slate-50/50 border border-slate-100 rounded-xl">
                      <div className="flex items-center gap-2">
                        <div className={cn("w-2 h-2 rounded-full", hasGateway ? "bg-emerald-500" : "bg-slate-300")} />
                        <span className="text-sm font-bold text-slate-700">{t("overview.channel_public_gateway")}</span>
                      </div>
                      <span className="text-xs font-bold text-slate-500">
                        {hasGateway ? t("overview.channel_running_well") : t("overview.channel_not_generated")}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </Card>
          </section>

          {/* Plan Quotas & System Summary (保留，低视觉优先级) */}
          <section>
            <h4 className="font-black text-slate-900 mb-4 flex items-center gap-2 px-1 text-xl">
              <CreditCard className="w-6 h-6 text-emerald-500" />
              {t("overview.system_status_summary")}
            </h4>
            
            <Card className="p-5 border-slate-100 shadow-sm bg-white rounded-2xl relative overflow-hidden group">
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-2 text-sm mb-1">
                  <span className="font-bold text-slate-600 min-w-0">{t("overview.quota_available")}</span>
                  <div className="flex flex-col items-end gap-1 shrink-0 max-w-[60%]">
                    <span className="max-w-full truncate px-3 py-1 bg-emerald-50 text-emerald-700 text-[11px] font-black rounded-full border border-emerald-200 uppercase tracking-widest dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-400/30">
                      {resourcePolicy?.resource_plan || t(isAdmin ? "overview.admin.planAdmin" : "overview.admin.planFree")}
                    </span>
                    <span className="font-black text-slate-900 text-base leading-none">
                      {activeInstances.length} / {stats?.totalInstances || 1}
                    </span>
                  </div>
                </div>
                <div className="w-full h-2 bg-slate-50 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-emerald-500 transition-all duration-700" 
                    style={{ width: `${Math.min(100, (activeInstances.length / (stats?.totalInstances || 1)) * 100)}%` }} 
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 text-sm mt-2">
                  <div>
                    <p className="text-xs font-bold text-slate-500 uppercase mb-1">{t("overview.quota_cpu_spec")}</p>
                    <p className="font-black text-slate-900 text-base">{t("overview.cpu_cores", { count: resourcePolicy?.default_cpu_limit || 0.5 })}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-500 uppercase mb-1">{t("overview.quota_memory")}</p>
                    <p className="font-black text-slate-900 text-base">{resourcePolicy?.default_memory_limit_mb || 512} MB</p>
                  </div>
                </div>
              </div>
            </Card>
          </section>

        </div>
      </div>

      {/* Admin Infrastructure Section (Keep only for admin) */}
      {isAdmin && (
        <section className="pt-8 border-t border-slate-100">
           <div className="flex justify-between items-center mb-6">
              <h4 className="font-black text-slate-900 flex items-center gap-2">
                <Server className="w-5 h-5 text-indigo-500" />
                {t("overview.admin.title")}
              </h4>
              <div className="flex items-center gap-2">
                <span className={cn("flex h-2.5 w-2.5 rounded-full animate-pulse", adminOverview?.health.level === 'critical' ? 'bg-red-500' : adminOverview?.health.level === 'warning' ? 'bg-amber-500' : 'bg-green-500')} />
                <span className="text-[10px] text-slate-500 font-black uppercase tracking-wider">{t("overview.admin.live")}</span>
              </div>
            </div>
            
            <Card className="p-6 border-slate-100 shadow-md relative bg-white overflow-hidden">
               {adminStatsError ? (
                  <div className="py-12 flex flex-col items-center justify-center text-slate-400">
                     <ServerCrash className="w-10 h-10 mb-4 opacity-50" />
                     <p className="text-sm font-medium">{t("overview.admin.unavailable")}</p>
                  </div>
                ) : !adminOverview ? (
                  <div className="py-12 flex flex-col items-center justify-center text-slate-400">
                     <RotateCw className="w-8 h-8 animate-spin mb-4 opacity-50" />
                     <p className="text-sm font-medium">{t("overview.admin.loading")}</p>
                  </div>
                ) : (
                  <div className="space-y-8">
                     <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="p-3 bg-slate-50/50 rounded-2xl border border-slate-100">
                          <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">{t("overview.admin.remainingCapacity")}</p>
                          <p className="text-xl font-black text-slate-900">{adminOverview.instances.remaining}</p>
                        </div>
                        <div className="p-3 bg-slate-50/50 rounded-2xl border border-slate-100">
                          <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">{t("overview.admin.activeContainers")}</p>
                          <p className="text-xl font-black text-blue-600">{adminOverview.instances.running}</p>
                        </div>
                        <div className="p-3 bg-slate-50/50 rounded-2xl border border-slate-100">
                          <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">{t("overview.admin.failedNodes")}</p>
                          <p className={cn("text-xl font-black", adminOverview.instances.error > 0 ? "text-red-500" : "text-emerald-500")}>
                             {adminOverview.instances.error}
                          </p>
                        </div>
                        <div className="p-3 bg-slate-50/50 rounded-2xl border border-slate-100">
                          <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">{t("overview.admin.pressureLevel")}</p>
                          <p className={cn("text-xl font-black", adminOverview.health.level === 'critical' ? 'text-red-600' : adminOverview.health.level === 'warning' ? 'text-amber-600' : 'text-emerald-600')}>
                             {t(adminOverview.health.level === "critical" ? "overview.admin.levelCritical" : adminOverview.health.level === "warning" ? "overview.admin.levelWarning" : "overview.admin.levelHealthy")}
                          </p>
                        </div>
                     </div>

                     <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        <div className="space-y-2">
                           <div className="flex justify-between items-end text-[11px] font-black">
                             <span className="text-slate-600 flex items-center gap-1.5"><Cpu className="w-3.5 h-3.5"/> {t("overview.admin.cpuLoad")}</span>
                             <span className={cn(adminOverview.system.cpuPercent > 80 ? "text-red-600" : adminOverview.system.cpuPercent > 60 ? "text-amber-600" : "text-slate-900")}>
                               {adminOverview.system.cpuPercent}%
                             </span>
                           </div>
                           <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                             <div 
                               className={cn("h-full transition-all duration-1000", adminOverview.system.cpuPercent > 80 ? "bg-red-500" : adminOverview.system.cpuPercent > 60 ? "bg-amber-500" : "bg-blue-500")} 
                               style={{ width: `${Math.min(100, adminOverview.system.cpuPercent)}%` }} 
                             />
                           </div>
                        </div>

                        <div className="space-y-2">
                           <div className="flex justify-between items-end text-[11px] font-black">
                             <span className="text-slate-600 flex items-center gap-1.5"><Activity className="w-3.5 h-3.5"/> {t("overview.admin.memoryUsage")}</span>
                             <span className={cn(adminOverview.system.memoryPercent > 85 ? "text-red-600" : adminOverview.system.memoryPercent > 70 ? "text-amber-600" : "text-slate-900")}>
                               {adminOverview.system.memoryUsedMb.toFixed(1)} GB / {adminOverview.system.memoryTotalMb.toFixed(1)} GB
                             </span>
                           </div>
                           <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                             <div 
                               className={cn("h-full transition-all duration-1000", adminOverview.system.memoryPercent > 85 ? "bg-red-500" : adminOverview.system.memoryPercent > 70 ? "bg-amber-500" : "bg-indigo-500")}
                               style={{ width: `${Math.min(100, adminOverview.system.memoryPercent)}%` }} 
                             />
                           </div>
                        </div>

                        <div className="space-y-2">
                           <div className="flex justify-between items-end text-[11px] font-black">
                             <span className="text-slate-600 flex items-center gap-1.5"><HardDrive className="w-3.5 h-3.5"/> {t("overview.admin.diskUsage")}</span>
                             <span className={cn(adminOverview.system.diskPercent > 90 ? "text-red-600" : adminOverview.system.diskPercent > 75 ? "text-amber-600" : "text-slate-900")}>
                               {adminOverview.system.diskUsedGb.toFixed(1)} GB / {adminOverview.system.diskTotalGb.toFixed(1)} GB
                             </span>
                           </div>
                           <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                             <div 
                               className={cn("h-full transition-all duration-1000", adminOverview.system.diskPercent > 90 ? "bg-red-500" : adminOverview.system.diskPercent > 75 ? "bg-amber-500" : "bg-emerald-500")}
                               style={{ width: `${Math.min(100, adminOverview.system.diskPercent)}%` }} 
                             />
                           </div>
                        </div>
                     </div>

                     {adminOverview.health.issues.length > 0 && (
                        <div className="mt-4 flex flex-col gap-2">
                          {adminOverview.health.issues.map((issue, idx) => (
                             <div key={idx} className={cn("p-4 rounded-xl text-xs font-bold border flex items-start gap-3", issue.severity === 'critical' ? 'bg-red-50 border-red-200 text-red-800 shadow-sm' : issue.severity === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-blue-50 border-blue-200 text-blue-800')}>
                               <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
                               <div className="space-y-0.5">
                                 <p className="uppercase tracking-widest text-[9px] opacity-70">{t("overview.admin.systemNotice", { type: issue.type })}</p>
                                 <p>{issue.message}</p>
                               </div>
                             </div>
                          ))}
                        </div>
                     )}
                  </div>
               )}
            </Card>
        </section>
      )}
    </div>
  );
}

function Key({ className, style }: any) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width="24" 
      height="24" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
      style={style}
    >
      <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4.3a1 1 0 0 0-1.4 0l-2.1 2.1a1 1 0 0 0 0 1.4Z" />
      <path d="m15.5 7.5-3 3" />
      <path d="m13.5 13.5-3 3" />
      <path d="m11.5 15.5-3 3" />
      <path d="M5.5 15.5 2.5 18.5a1 1 0 0 0 0 1.4l2.1 2.1a1 1 0 0 0 1.4 0l3-3" />
      <circle cx="15.5" cy="7.5" r=".5" fill="currentColor" />
    </svg>
  );
}

function RefreshCw({ className, style }: any) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width="24" 
      height="24" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
      style={style}
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}
