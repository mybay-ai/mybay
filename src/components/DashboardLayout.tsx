import { useState, useEffect } from "react";
import {
  Plus, Box, BookOpen, LogOut, Menu, X, Settings, Cpu, HelpCircle, ShieldAlert, Grid,
  LayoutDashboard, ShieldCheck, History, FileLock, FileText, FolderOpen, LucideIcon, CheckCircle2, LifeBuoy, MessageSquare, Github
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BrandLogo } from "./BrandLogo";
import { useInstanceQuota } from "../hooks/useInstanceQuota";
import { ErrorBoundary } from "./ErrorBoundary";
import { APP_ROUTES } from "../constants/routes";
import { getTabConfig } from "./dashboard/dashboardTabs.config";
import { LanguageToggle } from "./LanguageToggle";
import { ThemeModeToggle } from "./ThemeModeToggle";
import { clearCompletedChatNotifications, getCompletedChatCount, subscribeToChatNotifications } from "../lib/chatWorkspaceNotifications";

interface DashboardLayoutProps {
  children: React.ReactNode;
  currentUser: any;
  onLogout: () => void | Promise<void>;
  setShowProfileModal: (show: boolean) => void;
  instances?: any[];
  templateCenterEnabled?: boolean;
}

const ALLOWED_DASHBOARD_TABS = [
  'overview',
  'instance-files',
  'versions',
  'tasks',
  'system',
  'template-content',
  'contact'
];

function isAllowedDashboardTab(tab: string, isAdmin: boolean): boolean {
  if (!ALLOWED_DASHBOARD_TABS.includes(tab)) {
    return false;
  }
  const config = getTabConfig(tab);
  if (!config) {
    return false;
  }
  if (config.adminOnly && !isAdmin) {
    return false;
  }
  return true;
}

export function DashboardLayout({ children, currentUser, onLogout, setShowProfileModal, instances = [], templateCenterEnabled }: DashboardLayoutProps) {
  const { t, i18n } = useTranslation("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showQuotaModal, setShowQuotaModal] = useState(false);
  const [completedChatCount, setCompletedChatCount] = useState(0);
  const [chatCompletionNotice, setChatCompletionNotice] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const isTemplateCenterEnabled = !!templateCenterEnabled;
  const isAdmin = currentUser?.role === 'admin' || (currentUser?.role as string) === 'super_admin';
  const isChatWorkspace = location.pathname === APP_ROUTES.CHAT_WORKSPACE;
  const notificationUserId = String(currentUser?.id || currentUser?.username || "");

  useEffect(() => {
    if (!notificationUserId) return;
    setCompletedChatCount(getCompletedChatCount(notificationUserId));
    return subscribeToChatNotifications(notificationUserId, (count) => {
      setCompletedChatCount(count);
      if (count > 0 && !isChatWorkspace) {
        setChatCompletionNotice(true);
        window.setTimeout(() => setChatCompletionNotice(false), 5000);
      }
    });
  }, [notificationUserId, isChatWorkspace]);
  useEffect(() => {
    if (isChatWorkspace && notificationUserId && completedChatCount > 0) {
      clearCompletedChatNotifications(notificationUserId);
      setCompletedChatCount(0);
      setChatCompletionNotice(false);
    }
  }, [isChatWorkspace, notificationUserId, completedChatCount]);

  const quota = useInstanceQuota(currentUser, instances);
  const isQuotaExceeded = !quota.canCreateInstance;

  // Track the active tab within the dashboard
  const [activeTab, setActiveTab] = useState<string>(() => {
    if (location.pathname === APP_ROUTES.INSTANCES) return 'instances';
    if (location.pathname === APP_ROUTES.CREDENTIALS) return 'credentials';
    if (location.pathname === APP_ROUTES.DASHBOARD) {
      const params = new URLSearchParams(location.search);
      const queryTab = params.get("tab");
      if (queryTab && isAllowedDashboardTab(queryTab, isAdmin)) {
        return queryTab;
      }
      if (location.state && (location.state as any).activeTab) {
        const stateTab = (location.state as any).activeTab;
        if (isAllowedDashboardTab(stateTab, isAdmin)) {
          return stateTab;
        }
      }
    }
    return 'overview';
  });

  // Listen to the dashboard's active tab change events
  useEffect(() => {
    const handleTabChanged = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && isAllowedDashboardTab(customEvent.detail, isAdmin)) {
        setActiveTab(customEvent.detail);
      }
    };
    window.addEventListener("dashboard-tab-changed", handleTabChanged);
    return () => {
      window.removeEventListener("dashboard-tab-changed", handleTabChanged);
    };
  }, [isAdmin]);

  // Sync activeTab when URL changes
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

  const handleNavigate = (item: { path?: string; tab?: string; disabled?: boolean }) => {
    if (item.disabled) {
      setShowQuotaModal(true);
      return;
    }
    setSidebarOpen(false);

    if (item.tab) {
      const targetPath = item.path || APP_ROUTES.DASHBOARD;
      if (targetPath === APP_ROUTES.DASHBOARD) {
        navigate(`${targetPath}?tab=${item.tab}`, { state: { activeTab: item.tab } });
      } else {
        navigate(targetPath, { state: { activeTab: item.tab } });
      }
    } else if (item.path) {
      navigate(item.path);
    }
  };

  const isItemActive = (path?: string, tab?: string) => {
    if (tab) {
      if (activeTab !== tab) return false;
      const targetPath = path || APP_ROUTES.DASHBOARD;
      return location.pathname === targetPath;
    }
    if (path) {
      return location.pathname === path;
    }
    return false;
  };

  const renderNavItem = (item: { label: string; icon: LucideIcon; path?: string; tab?: string; disabled?: boolean; tooltip?: string; badge?: number }) => {
    const isActive = isItemActive(item.path, item.tab);
    return (
      <button
        key={item.label}
        type="button"
        onClick={() => handleNavigate(item)}
        className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[15px] tracking-tight transition-all duration-100 relative group font-normal ${
          isActive
            ? "bg-nav-active text-content font-medium"
            : item.disabled
              ? "opacity-40 cursor-not-allowed text-content-muted"
              : "text-content-secondary hover:bg-nav-hover hover:text-content"
        }`}
        title={item.tooltip}
      >
        <item.icon className={`w-3.5 h-3.5 shrink-0 transition-colors ${isActive ? "text-content" : "text-content-muted group-hover:text-content-secondary"}`} />
        <span className="truncate">{item.label}</span>
        {item.badge ? <span className="ml-auto rounded-full bg-indigo-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">{item.badge > 99 ? "99+" : item.badge}</span> : null}
      </button>
    );
  };

  const getBreadcrumbTitle = () => {
    if (location.pathname === APP_ROUTES.DASHBOARD) {
      switch (activeTab) {
        case "overview": return t("nav.overview");
        case "instance-files": return t("nav.instance_files");
        case "versions": return t("nav.versions");        case "tasks": return t("nav.tasks");
        case "system": return t("nav.system_security");
        case "template-content": return t("nav.template_admin");
        case "contact": return t("nav.community", { defaultValue: "开源社区" });
        default: return t("breadcrumb.control_panel");
      }
    }
    switch (location.pathname) {
      case APP_ROUTES.INSTANCES: return t("nav.instances");
      case APP_ROUTES.DEPLOY: return t("nav.deploy");
      case APP_ROUTES.TEMPLATES: return t("nav.templates");
      case APP_ROUTES.CREDENTIALS: return t("nav.credentials");
      case APP_ROUTES.GUIDES: return t("nav.guides");
      case APP_ROUTES.CHAT_WORKSPACE: return t("nav.chat_workspace");      default: return t("breadcrumb.control_panel");
    }
  };

  return (
    <div className="flex h-screen bg-app-canvas text-content font-sans overflow-hidden transition-colors duration-200">
      {/* Sidebar background overlay on mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-slate-900/30 backdrop-blur-xs z-40 lg:hidden animate-fade-in"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 w-60 bg-sidebar border-r border-outline flex flex-col p-4 gap-5 z-50
        transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:z-20 lg:flex
        ${sidebarOpen ? "translate-x-0 shadow-lg animate-slide-in" : "-translate-x-full lg:shadow-none"}
      `}>
        <div className="flex items-center justify-between px-1.5 mt-1 shrink-0">
          <Link
            to="/"
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            aria-label="MyBay"
          >
            <BrandLogo size="sm" textColor="text-content" invertOnDark />
          </Link>

          <button
            type="button"
            className="p-2 -mr-1 text-content-muted hover:text-content lg:hidden hover:bg-nav-hover rounded-lg transition-colors flex items-center justify-center w-8 h-8"
            onClick={() => setSidebarOpen(false)}
            title={t("nav.close_menu")}
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* Grouped Sidebar Navigation */}
        <nav className="flex flex-col gap-6 flex-1 overflow-y-auto scrollbar-thin pr-0.5 pb-4 select-none">
          {/* 第一组：工作区 */}
          <div className="flex flex-col gap-0.5">
            <div className="text-[13px] font-medium text-content-muted tracking-tight px-2.5 mb-1.5 select-none">
              {t("nav_group_workbench")}
            </div>
      {renderNavItem({ label: t("nav.overview"), icon: LayoutDashboard, path: APP_ROUTES.DASHBOARD, tab: "overview" })}
      {renderNavItem({ label: t("nav.instances"), icon: Box, path: APP_ROUTES.INSTANCES, tab: "instances" })}
      {renderNavItem({ label: t("nav.instance_files"), icon: FolderOpen, path: APP_ROUTES.DASHBOARD, tab: "instance-files" })}
      {renderNavItem({ label: t("nav.chat_workspace"), icon: MessageSquare, path: APP_ROUTES.CHAT_WORKSPACE, badge: completedChatCount })}
          </div>

          <div className="flex flex-col gap-0.5">
            <div className="text-[13px] font-medium text-content-muted tracking-tight px-2.5 mb-1.5 select-none">
              {t("nav_group_create")}
            </div>
      {renderNavItem({
        label: t("nav.deploy"),
        icon: Plus,
        path: APP_ROUTES.DEPLOY,
        disabled: isQuotaExceeded,
        tooltip: isQuotaExceeded ? t("nav.quota_exceeded_tooltip") : t("nav.new_instance_tooltip")
      })}
            {isTemplateCenterEnabled && renderNavItem({ label: t("nav.templates"), icon: Grid, path: APP_ROUTES.TEMPLATES })}          </div>

          {/* 第二组：资源与配置 */}
          <div className="flex flex-col gap-0.5">
            <div className="text-[13px] font-medium text-content-muted tracking-tight px-2.5 mb-1.5 select-none">
              {t("nav_group_security_ops")}
            </div>
            {renderNavItem({ label: t("nav.credentials"), icon: ShieldCheck, path: APP_ROUTES.CREDENTIALS, tab: "credentials" })}
            {renderNavItem({ label: t("nav.versions"), icon: History, path: APP_ROUTES.DASHBOARD, tab: "versions" })}
          </div>

          {/* 第三组：系统管理（仅管理员可见） */}
          {isAdmin && (
            <div className="flex flex-col gap-0.5 pt-1">
              <div className="text-[13px] font-medium text-content-muted tracking-tight px-2.5 mb-1.5 flex items-center justify-between select-none">
                <span>{t("nav_group_system")}</span>
                <span className="text-[12px] bg-control text-content-muted px-1.5 py-0.5 rounded font-normal tracking-wide border border-outline uppercase select-none">{t("admin_badge")}</span>
              </div>              {isTemplateCenterEnabled && renderNavItem({ label: t("nav.tasks"), icon: CheckCircle2, path: APP_ROUTES.DASHBOARD, tab: "tasks" })}
              {renderNavItem({ label: t("nav.system_security"), icon: ShieldAlert, path: APP_ROUTES.DASHBOARD, tab: "system" })}
              {isTemplateCenterEnabled && renderNavItem({ label: t("nav.template_admin"), icon: FileText, path: APP_ROUTES.DASHBOARD, tab: "template-content" })}            </div>
          )}

          {/* 第四组：帮助 */}
          <div className="flex flex-col gap-0.5">
            <div className="text-[13px] font-medium text-content-muted tracking-tight px-2.5 mb-1.5 select-none">
              {t("nav_group_help")}
            </div>
            {renderNavItem({ label: t("nav.guides"), icon: BookOpen, path: APP_ROUTES.GUIDES })}
            {renderNavItem({ label: t("nav.faq"), icon: HelpCircle, path: "/faq" })}
            {renderNavItem({ label: t("nav.community", { defaultValue: "开源社区" }), icon: Github, path: APP_ROUTES.DASHBOARD, tab: "contact" })}
          </div>
        </nav>

        <div className="mt-auto pt-3 border-t border-outline">
          <div className="flex items-center gap-2.5 p-1.5 rounded-lg hover:bg-nav-hover transition-colors duration-150 group">
            <button
              type="button"
              onClick={() => {
                setShowProfileModal(true);
                setSidebarOpen(false);
              }}
              className="flex items-center gap-2 flex-1 overflow-hidden text-left"
            >
              <div className="w-7 h-7 rounded-full bg-avatar flex items-center justify-center text-content-secondary font-semibold shrink-0 text-[11px] overflow-hidden border border-outline">
                {currentUser.avatar_url ? (
                  <img src={currentUser.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  currentUser.username.charAt(0).toUpperCase()
                )}
              </div>
              <div className="flex flex-col overflow-hidden">
                <span className="text-xs font-medium text-content truncate">{currentUser.username}</span>
                <span className="text-[12px] text-content-muted group-hover:text-content-secondary transition-colors truncate">{t("user.modify_profile")}</span>
              </div>
            </button>
            <button
              onClick={() => void onLogout()}
              className="p-1 text-content-muted hover:text-content-secondary hover:bg-nav-hover rounded-md transition-colors shrink-0"
              title={t("user.logout")}
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main id="main-workspace" className="flex-1 flex flex-col h-screen overflow-hidden relative bg-app-canvas transition-colors duration-200">
        <header className="h-12 bg-header backdrop-blur-md border-b border-outline flex items-center justify-between px-6 sm:px-8 shrink-0 z-10 sticky top-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 -ml-2 text-content-muted hover:text-content lg:hidden hover:bg-nav-hover rounded-lg transition-colors flex items-center justify-center w-8 h-8"
              title={t("nav.open_menu")}
            >
              <Menu className="w-4.5 h-4.5" />
            </button>
            <nav className="flex items-center space-x-1.5 text-[15px] font-medium text-content-muted tracking-tight select-none">
              <Link
                to={`${APP_ROUTES.DASHBOARD}?tab=overview`}
                state={{ activeTab: "overview" }}
                onClick={() => window.dispatchEvent(new CustomEvent("reset-dashboard-tab", { detail: "overview" }))}
                className="hover:text-content-secondary transition-colors cursor-pointer"
              >
                {t("breadcrumb.console")}
              </Link>
              <span className="text-outline-strong font-light">/</span>
              <span className="text-content font-semibold">
                {getBreadcrumbTitle()}
              </span>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <ThemeModeToggle />
            <LanguageToggle variant="inline" />
          </div>
        </header>

        <div className={`flex-1 overflow-y-auto w-full relative -z-0 scrollbar-thin ${isChatWorkspace ? "px-3 py-4 sm:px-5 sm:py-5 lg:px-6 lg:py-6" : "px-4 py-5 sm:p-6 lg:p-8"}`}>
          <div className={`${isChatWorkspace ? "max-w-[1680px]" : "max-w-7xl"} mx-auto w-full pb-10 min-w-0`}>
            <ErrorBoundary>
              {children}
            </ErrorBoundary>
          </div>
        </div>
      </main>

      {chatCompletionNotice && !isChatWorkspace && (
        <button type="button" onClick={() => navigate(APP_ROUTES.CHAT_WORKSPACE)} className="fixed right-4 top-4 z-[70] rounded-lg border border-indigo-200 bg-surface px-3 py-2 text-[13px] text-content-secondary shadow-lg dark:border-indigo-400/30 dark:bg-slate-900 dark:text-slate-100">
          {t("chatWorkspace.completionNotice", { defaultValue: "Agent 对话已完成，点击查看结果" })}
        </button>
      )}

      {showQuotaModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/30 flex items-end md:items-center justify-center backdrop-blur-xs p-0 md:p-4 animate-fade-in">
          <div className="absolute inset-0 z-0" onClick={() => setShowQuotaModal(false)} />
          <div className="bg-popover rounded-t-2xl md:rounded-xl w-full max-w-md overflow-hidden shadow-xl animate-in fade-in slide-in-from-bottom-8 md:zoom-in-95 duration-200 relative z-10 p-6 pb-8 md:pb-6 border border-outline">
            <div className="flex items-start gap-4">
              <div className="p-2 bg-red-50 text-red-600 rounded-lg shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div className="space-y-1 flex-1 text-left">
                <h3 className="text-base font-semibold text-content">{t("quota_modal.title")}</h3>
                <p className="text-sm text-content-secondary leading-relaxed">
                  {t("quota_modal.description", { maxActive: quota.maxActiveInstances })}
                </p>
              </div>
            </div>

            <div className="mt-5">
              <div className="p-3 bg-control border border-outline rounded-lg flex items-center justify-between text-xs">
                <span className="text-content-secondary font-medium">{t("quota_modal.active_badge")}</span>
                <span className="font-semibold text-content font-mono">{quota.activeInstances} / {quota.maxActiveInstances} ({t("quota_modal.license_type")})</span>
              </div>
            </div>

            <div className="mt-6 flex gap-3 md:justify-end">
              <button
                type="button"
                className="flex-1 md:flex-none px-4 py-2 bg-control hover:bg-control-hover text-content-secondary text-xs font-medium rounded-lg transition-colors border border-outline"
                onClick={() => setShowQuotaModal(false)}
              >
                {t("quota_modal.btn_close")}
              </button>
              <button
                type="button"
                className="flex-1 md:flex-none px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg transition-colors inline-flex justify-center items-center gap-1.5 shadow-xs"
                onClick={() => {
                  setShowQuotaModal(false);
                  navigate(APP_ROUTES.INSTANCES);
                }}
              >
                {t("quota_modal.btn_view")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


