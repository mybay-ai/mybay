import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../ui";
import { DASHBOARD_TABS } from "./dashboardTabs.config";

interface DashboardTabsProps {
  activeTab: string;
  setActiveTab: (tab: any) => void;
  currentUser: any;
}

export function DashboardTabs({ activeTab, setActiveTab, currentUser }: DashboardTabsProps) {
  const { t } = useTranslation("dashboard");
  const visibleTabs = DASHBOARD_TABS.filter(tab => !tab.adminOnly || currentUser?.role === 'admin' || (currentUser?.role as string) === 'super_admin');

  return (
    <div className="border-b border-slate-200 mb-6 overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
      <nav className="-mb-px flex space-x-6 sm:space-x-8 min-w-max" aria-label="Tabs">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          
          return (
            <button
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key);
              }}
              className={cn(
                "border-b-2 py-4 px-1 text-sm font-medium transition-colors whitespace-nowrap outline-none flex items-center gap-2",
                isActive
                  ? "border-blue-500 text-blue-600 font-bold"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
              )}
            >
              <Icon className={cn("w-3.5 h-3.5", tab.key === 'versions' && isActive && "animate-spin")} 
                     style={tab.key === 'versions' && isActive ? { animationDuration: '6s' } : undefined} />
              {t(`tabs.${tab.key}.label`, { defaultValue: tab.label })}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
