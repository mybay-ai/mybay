import React, { useState, useEffect, useRef, lazy, Suspense } from "react";
import { Socket } from "socket.io-client";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import type { AgentInstance, User } from "../types";
import { APP_ROUTES, buildInstanceFilesNavigationUrl } from "../constants/routes";
import { InstanceSettingsModal } from "./InstanceSettingsModal";
import { AgentDeploymentHome } from "./AgentDeploymentHome";
import { CredentialsSection } from "./CredentialsSection";

import { BookOpen, ExternalLink, HelpCircle, Github, MessageSquare } from "lucide-react";

// Lazy-loaded low-frequency dashboard tabs for performance optimization
const VersionManagement = lazy(() => import("./VersionManagement").then(m => ({ default: m.VersionManagement })));
const TaskCenter = lazy(() => import("./TaskCenter").then(m => ({ default: m.TaskCenter })));
const SystemSecuritySettings = lazy(() => import("./SystemSecuritySettings").then(m => ({ default: m.SystemSecuritySettings })));
const TemplateContentAdmin = lazy(() => import("./TemplateContentAdmin").then(m => ({ default: m.TemplateContentAdmin })));

// Modular Dashboard Components
import { InstancesPanel } from "./dashboard/InstancesPanel";
import { InstanceDetailPanel } from "./dashboard/InstanceDetailPanel";
import { MobileInstanceSheet } from "./dashboard/MobileInstanceSheet";
import { useInstanceActions } from "./dashboard/useInstanceActions";
import { getRefinedStatusLabel } from "./dashboard/instanceStatus";
import { getTabConfig } from "./dashboard/dashboardTabs.config";
import { InstanceRenameModal } from "./dashboard/InstanceRenameModal";
import { InstanceFilesWorkspace } from "./dashboard/InstanceFilesWorkspace";

const DashboardLoader = () => (
  <div className="flex items-center justify-center min-h-[300px]">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
  </div>
);

export { getRefinedStatusLabel };

const ALLOWED_DASHBOARD_TABS = [
  'overview',
  'instance-files',
  'versions',
  'tasks',
  'system',
  'template-content',
  'contact'
];

function isAllowedDashboardTab(tab: string, isAdmin: boolean, templateWorkflowsEnabled = true): boolean {
  if (!ALLOWED_DASHBOARD_TABS.includes(tab)) {
    return false;
  }
  const config = getTabConfig(tab);
  if (!templateWorkflowsEnabled && (tab === "tasks" || tab === "template-content")) {
    return false;
  }
  if (!config) {
    return false;
  }
  if (config.adminOnly && !isAdmin) {
    return false;
  }
  return true;
}

function isValidTab(tab: string, isAdmin: boolean, templateWorkflowsEnabled = true): boolean {
  if (tab === 'instances' || tab === 'credentials') {
    return true;
  }
  return isAllowedDashboardTab(tab, isAdmin, templateWorkflowsEnabled);
}

const DEFAULT_TAB_INFO: Record<string, { title: string; description: string }> = {
  overview: {
    title: "",
    description: ""
  },
  instances: {
    title: "Agent Instances",
    description: "Manage and monitor local Agent instances"
  },
  "instance-files": {
    title: "",
    description: ""
  },
  credentials: {
    title: "Credentials & Secrets",
    description: "Securely manage API keys, OAuth credentials, and channel tokens"
  },
  versions: {
    title: "Agent Versions",
    description: "Browse Agent releases and compatibility guides"
  },
  tasks: {
    title: "Background Tasks",
    description: "Monitor asynchronous worker tasks and queues"
  },
  system: {
    title: "System Security",
    description: "Configure high-risk permissions and system security"
  },
  "template-content": {
    title: "Template Management",
    description: "Manage and publish workflows and blueprint templates"
  },
  "contact": {
    title: "Open Source Community",
    description: "Access guides, GitHub repository, and community support"
  }
};

export function Dashboard({ instances, loading, fetchInstances, socket, currentUser, onViewGuide, templateWorkflowsEnabled = false, advancedResourceConfigEnabled = false }: { instances: AgentInstance[], loading?: boolean, fetchInstances: () => void, socket: Socket | null, currentUser: User, onViewGuide?: (guideId: string) => void, templateWorkflowsEnabled?: boolean, advancedResourceConfigEnabled?: boolean }) {
  const { t, i18n } = useTranslation("dashboard");
  const location = useLocation();
  const navigate = useNavigate();
  const isAdmin = currentUser?.role === 'admin' || (currentUser?.role as string) === 'super_admin';
  const [activeTab, setActiveTab] = useState<string>(() => {
    const params = new URLSearchParams(location.search);
    const queryTab = params.get("tab");
    if (queryTab && isAllowedDashboardTab(queryTab, isAdmin, templateWorkflowsEnabled)) {
      return queryTab;
    }
    if (location.state && (location.state as any).activeTab) {
      const stateTab = (location.state as any).activeTab;
      if (isAllowedDashboardTab(stateTab, isAdmin, templateWorkflowsEnabled)) {
        return stateTab;
      }
    }
    return location.pathname === APP_ROUTES.INSTANCES ? 'instances' :
           location.pathname === APP_ROUTES.CREDENTIALS ? 'credentials' : 'overview';
  });

  const activeTabConfig = getTabConfig(activeTab);

  // Synchronize internal state with the layout sidebar
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("dashboard-tab-changed", { detail: activeTab }));
  }, [activeTab]);

  const handleTabChange = (key: string) => {
  useEffect(() => {
    if (!isValidTab(activeTab, isAdmin, templateWorkflowsEnabled)) {
      setActiveTab("overview");
      navigate(APP_ROUTES.DASHBOARD, { replace: true });
    }
  }, [activeTab, isAdmin, navigate, templateWorkflowsEnabled]);

    if (!isValidTab(key, isAdmin, templateWorkflowsEnabled)) {
      setActiveTab('overview');
      navigate(APP_ROUTES.DASHBOARD);
      return;
    }

    const config = getTabConfig(key);
    setActiveTab(key);
    if (config?.path) {
      navigate(config.path);
    } else {
      navigate(`${APP_ROUTES.DASHBOARD}?tab=${key}`, { state: { activeTab: key } });
    }
  };

  const {
    copiedId,
    deletingIds,
    actioningIds,
    handleInstanceAction,
    handleRecheckHealth,
    handleDelete,
    handleArchive,
    handleRestore,
    handleBulkDelete,
    handleExportConfig,
    handleCopyUrl,
    handleOpenLink
  } = useInstanceActions(fetchInstances, currentUser);

  useEffect(() => {
    if (location.pathname === APP_ROUTES.INSTANCES) {
      setActiveTab('instances');
    } else if (location.pathname === APP_ROUTES.CREDENTIALS) {
      setActiveTab('credentials');
    } else if (location.pathname === APP_ROUTES.DASHBOARD) {
      const params = new URLSearchParams(location.search);
      const queryTab = params.get("tab");
      if (queryTab) {
        if (isAllowedDashboardTab(queryTab, isAdmin)) {
          setActiveTab(queryTab);
        } else {
          setActiveTab('overview');
          navigate(APP_ROUTES.DASHBOARD, { replace: true });
        }
      } else if (location.state && (location.state as any).activeTab) {
        const stateTab = (location.state as any).activeTab;
        if (isAllowedDashboardTab(stateTab, isAdmin)) {
          setActiveTab(stateTab);
        } else {
          setActiveTab('overview');
        }
      } else {
        setActiveTab('overview');
      }
    }
  }, [location.pathname, location.search, location.state, isAdmin, navigate]);

  useEffect(() => {
    const handleResetTab = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && typeof customEvent.detail === 'string') {
        const tabKey = customEvent.detail;
        if (isAllowedDashboardTab(tabKey, isAdmin)) {
          handleTabChange(tabKey);
        } else {
          handleTabChange('overview');
        }
      }
    };
    window.addEventListener("reset-dashboard-tab", handleResetTab);
    return () => {
      window.removeEventListener("reset-dashboard-tab", handleResetTab);
    };
  }, [isAdmin, navigate]);

  const [activeLogs, setActiveLogs] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'logs' | 'files' | 'context' | 'diagnostics'>('logs');

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const instanceId = params.get("id");
    const tab = params.get("tab");
    if (instanceId) {
      setActiveLogs(instanceId);
      if (tab === "files") {
        setDetailTab("files");
      } else {
        setDetailTab("logs");
      }
      // Clean up search params from the address bar so they don't lingeringly reload
      navigate(location.pathname, { replace: true });
    }
  }, [location.search, navigate, location.pathname]);
  const [editingInstance, setEditingInstance] = useState<AgentInstance | null>(null);
  const [renamingInstance, setRenamingInstance] = useState<AgentInstance | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>(() => {
    if (typeof window === "undefined") return 'grid';
    return (localStorage.getItem('dashboard_view_mode') as 'grid' | 'table') || 'grid';
  });

  const handleSetViewMode = (mode: 'grid' | 'table') => {
    setViewMode(mode);
    if (typeof window !== "undefined") {
      localStorage.setItem('dashboard_view_mode', mode);
    }
  };
  const [mobileMenuOpenInstance, setMobileMenuOpenInstance] = useState<AgentInstance | null>(null);
  const terminalDetailsRef = useRef<HTMLDivElement>(null);

  const handleOpenTerminalView = (instId: string, tab: 'logs' | 'files') => {
    if (tab === 'files') {
      setMobileMenuOpenInstance(null);
      navigate(buildInstanceFilesNavigationUrl(instId), {
        state: { activeTab: 'instance-files' }
      });
      return;
    }
    setActiveLogs(instId);
    setDetailTab(tab);
    setMobileMenuOpenInstance(null);
    setTimeout(() => {
      terminalDetailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  return (
    <div className="space-y-6 w-full max-w-full overflow-x-hidden pb-10">
      <div className="flex flex-col gap-2 pb-5 border-b border-outline/40 mb-8">
        <h1 className="text-xl sm:text-2xl font-semibold text-content tracking-tight">
          {t(`tabs.${activeTab}.title`, { defaultValue: DEFAULT_TAB_INFO[activeTab]?.title || "Workspace Center" })}
        </h1>
        <p className="text-xs sm:text-[13px] text-content-muted leading-relaxed max-w-4xl font-normal">
          {t(`tabs.${activeTab}.description`, { defaultValue: DEFAULT_TAB_INFO[activeTab]?.description || "Manage workspace and instances" })}
        </p>
      </div>
      
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          transition={{ duration: 0.12, ease: "easeOut" }}
          className="w-full"
        >
          <Suspense fallback={<DashboardLoader />}>
            {activeTab === 'overview' ? (
              <AgentDeploymentHome
                currentUser={currentUser}
                instances={instances}
                onTabChange={handleTabChange}
              />
            ) : activeTab === 'instance-files' ? (
              <InstanceFilesWorkspace instances={instances} currentUser={currentUser} />
            ) : activeTab === 'credentials' ? (
              <CredentialsSection currentUser={currentUser} />
            ) : activeTab === 'versions' ? (
              <VersionManagement
                instances={instances}
                currentUser={currentUser}
                fetchInstances={fetchInstances}
                socket={socket}
              />
            ) : activeTab === 'tasks' && isAdmin && templateWorkflowsEnabled ? (
              <TaskCenter currentUser={currentUser} instances={instances} />
            ) : activeTab === 'system' && isAdmin ? (
              <SystemSecuritySettings currentUser={currentUser} advancedResourceConfigEnabled={advancedResourceConfigEnabled} />
            ) : activeTab === 'template-content' && isAdmin && templateWorkflowsEnabled ? (
              <TemplateContentAdmin currentUser={currentUser} />
            ) : activeTab === 'contact' ? (
              <div className="p-6 max-w-4xl mx-auto space-y-6">
                <div className="rounded-2xl border border-outline bg-surface p-6 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-3 bg-control-hover rounded-xl">
                      <Github className="w-6 h-6 text-content" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-content">{t("communitySupport.title")}</h2>
                      <p className="text-xs text-content-muted">{t("communitySupport.subtitle")}</p>
                    </div>
                  </div>
                  <p className="text-sm text-content-secondary leading-relaxed">
                    {t("communitySupport.description")}
                  </p>
                  <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                    <a
                      href="/app/guides"
                      className="flex flex-col p-4 rounded-xl border border-outline hover:border-indigo-300 dark:hover:border-indigo-700 bg-surface-muted/50 transition-all"
                    >
                      <span className="text-sm font-semibold text-content flex items-center justify-between">
                        {t("communitySupport.guides.title")} <BookOpen className="w-4 h-4 text-indigo-500" />
                      </span>
                      <span className="mt-1.5 text-xs text-content-muted leading-relaxed">
                        {t("communitySupport.guides.description")}
                      </span>
                    </a>
                    <a
                      href="https://github.com/nousresearch/hermes-agent"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex flex-col p-4 rounded-xl border border-outline hover:border-indigo-300 dark:hover:border-indigo-700 bg-surface-muted/50 transition-all"
                    >
                      <span className="text-sm font-semibold text-content flex items-center justify-between">
                        {t("communitySupport.github.title")} <ExternalLink className="w-4 h-4 text-content-muted" />
                      </span>
                      <span className="mt-1.5 text-xs text-content-muted leading-relaxed">
                        {t("communitySupport.github.description")}
                      </span>
                    </a>
                    <a
                      href="/faq"
                      className="flex flex-col p-4 rounded-xl border border-outline hover:border-indigo-300 dark:hover:border-indigo-700 bg-surface-muted/50 transition-all"
                    >
                      <span className="text-sm font-semibold text-content flex items-center justify-between">
                        {t("communitySupport.help.title")} <HelpCircle className="w-4 h-4 text-emerald-500" />
                      </span>
                      <span className="mt-1.5 text-xs text-content-muted leading-relaxed">
                        {t("communitySupport.help.description")}
                      </span>
                    </a>
                  </div>
                </div>
              </div>
            ) : (
              <InstancesPanel 
                instances={instances}
                loading={loading || false}
                viewMode={viewMode}
                setViewMode={handleSetViewMode}
                activeLogs={activeLogs}
                setActiveLogs={setActiveLogs}
                detailTab={detailTab}
                setDetailTab={setDetailTab}
                currentUser={currentUser}
                copiedId={copiedId}
                handleExportConfig={handleExportConfig}
                handleDelete={handleDelete}
                handleArchive={handleArchive}
                handleRestore={handleRestore}
                handleInstanceAction={handleInstanceAction}
                actioningIds={actioningIds}
                handleCopyUrl={handleCopyUrl}
                handleOpenLink={handleOpenLink}
                fetchInstances={fetchInstances}
                setEditingInstance={setEditingInstance}
                onRenameInstance={setRenamingInstance}
                setMobileMenuOpenInstance={setMobileMenuOpenInstance}
                onViewGuide={onViewGuide}
                handleOpenTerminalView={handleOpenTerminalView}
                deletingIds={deletingIds}
                handleBulkDelete={handleBulkDelete}
              />
            )}
          </Suspense>
        </motion.div>
      </AnimatePresence>

      {/* Terminal Details Block (Logs / Files) */}
      <InstanceDetailPanel 
        activeLogs={activeLogs}
        instances={instances}
        setActiveLogs={setActiveLogs}
        detailTab={detailTab}
        setDetailTab={setDetailTab}
        currentUser={currentUser}
        socket={socket}
        terminalDetailsRef={terminalDetailsRef}
      />

      {/* Instance Settings Modal */}
      {editingInstance && (
        <InstanceSettingsModal 
          instance={editingInstance} 
          currentUser={currentUser} 
          onClose={() => setEditingInstance(null)} 
          advancedResourceConfigEnabled={advancedResourceConfigEnabled}
          onSave={() => {
            setEditingInstance(null);
            fetchInstances();
          }}
        />
      )}

      {/* Instance Rename Modal */}
      {renamingInstance && (
        <InstanceRenameModal
          instance={renamingInstance}
          onClose={() => setRenamingInstance(null)}
          onSave={() => {
            setRenamingInstance(null);
            fetchInstances();
          }}
        />
      )}

      {/* Mobile Actions Drawer */}
      <MobileInstanceSheet 
        mobileMenuOpenInstance={mobileMenuOpenInstance}
        setMobileMenuOpenInstance={setMobileMenuOpenInstance}
        handleInstanceAction={handleInstanceAction}
        actioningIds={actioningIds}
        handleRecheckHealth={handleRecheckHealth}
        setEditingInstance={setEditingInstance}
        onRenameInstance={setRenamingInstance}
        handleArchive={handleArchive}
        handleRestore={handleRestore}
        handleExportConfig={handleExportConfig}
        handleDelete={handleDelete}
        handleOpenTerminalView={handleOpenTerminalView}
      />
    </div>
  );
}
