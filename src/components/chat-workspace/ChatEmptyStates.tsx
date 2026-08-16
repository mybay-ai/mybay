import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, BarChart3, BriefcaseBusiness, Code2, FileText, Globe2, Layers, Search, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AgentInstance } from "../../types";

type ChatNoInstancesEmptyStateProps = {
  onGoToInstanceManage: () => void;
};

export function ChatNoInstancesEmptyState({ onGoToInstanceManage }: ChatNoInstancesEmptyStateProps) {
  const { t } = useTranslation(["dashboard", "common"]);

  return (
    <div className="h-full flex flex-col items-center justify-center text-center p-6 select-none animate-fade-in max-w-md mx-auto">
      <div className="w-14 h-14 rounded-2xl bg-surface-muted flex items-center justify-center text-content-muted border border-outline/60 mb-4">
        <Layers className="w-7 h-7" />
      </div>
      <h3 className="text-sm font-semibold text-content">{t("dashboard:chatWorkspace.noActiveInstanceTitle")}</h3>
      <p className="text-[13px] text-content-muted leading-relaxed mt-2">
        {t("dashboard:chatWorkspace.noActiveInstanceDesc")}
      </p>
      <button
        onClick={onGoToInstanceManage}
        type="button"
        className="mt-5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors shadow-xs"
      >
        {t("dashboard:chatWorkspace.goToInstanceManage")}
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function ChatMessagesLoadingState() {
  const { t } = useTranslation(["dashboard", "common"]);

  return (
    <div className="h-full flex flex-col items-center justify-center text-content-muted text-[13px]">
      <div className="w-8 h-8 border-2 border-indigo-600/30 border-t-indigo-600 rounded-full animate-spin mb-3" />
      <span>{t("dashboard:chatWorkspace.loadingMessages")}</span>
    </div>
  );
}

type ChatWelcomeEmptyStateProps = {
  selectedInstance?: AgentInstance;
  loadingInstances?: boolean;
  onUsePrompt: (prompt: string) => void;
};

type TaskCategory = {
  id: string;
  icon: LucideIcon;
};

const TASK_CATEGORIES: TaskCategory[] = [
  { id: "office", icon: BriefcaseBusiness },
  { id: "document", icon: FileText },
  { id: "data", icon: BarChart3 },
  { id: "website", icon: Globe2 },
  { id: "research", icon: Search },
  { id: "code", icon: Code2 },
  { id: "product", icon: Sparkles }
];

const TASK_EXAMPLE_IDS = ["first", "second", "third"] as const;

export function ChatWelcomeEmptyState({ selectedInstance, loadingInstances = false, onUsePrompt }: ChatWelcomeEmptyStateProps) {
  const { t } = useTranslation(["dashboard", "common"]);
  const [activeCategory, setActiveCategory] = useState(TASK_CATEGORIES[0].id);
  const welcomeTitle = loadingInstances
    ? t("dashboard:chatWorkspace.preparingWorkspace")
    : selectedInstance?.name
      ? t("dashboard:chatWorkspace.newChatWelcome", { name: selectedInstance.name })
      : t("dashboard:chatWorkspace.selectInstanceToStart");
  const activeCategoryMeta = useMemo(
    () => TASK_CATEGORIES.find((category) => category.id === activeCategory) || TASK_CATEGORIES[0],
    [activeCategory]
  );
  const ActiveCategoryIcon = activeCategoryMeta.icon;

  return (
    <div className="h-full flex flex-col items-center justify-center text-center p-5 sm:p-6 select-none animate-fade-in mx-auto w-full max-w-3xl">
      <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100/50 mb-4 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-400/25">
        <Sparkles className="w-6 h-6" />
      </div>
      <h3 className="text-sm font-semibold text-content">
        {welcomeTitle}
      </h3>
      <p className="text-[13px] text-content-muted leading-relaxed mt-2 max-w-md">
        {t("dashboard:chatWorkspace.newChatWelcomeDesc")}
      </p>

      <div className="w-full mt-6 space-y-4 text-left">
        <div className="flex flex-wrap justify-center gap-2">
          {TASK_CATEGORIES.map((category) => {
            const Icon = category.icon;
            const active = category.id === activeCategory;
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => setActiveCategory(category.id)}
                className={
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-all " +
                  (active
                    ? "border-slate-900 bg-slate-900 text-white shadow-sm dark:border-indigo-400 dark:bg-indigo-500 dark:text-white"
                    : "border-outline bg-surface text-content-secondary hover:border-indigo-200 hover:text-indigo-700 hover:shadow-xs dark:hover:border-indigo-400/40 dark:hover:text-indigo-200")
                }
              >
                <Icon className="h-3.5 w-3.5" />
                {t("dashboard:chatWorkspace.taskCategories." + category.id + ".label")}
              </button>
            );
          })}
        </div>

        <div className="rounded-2xl border border-outline/80 bg-surface/90 p-3 shadow-sm">
          <div className="mb-3 flex items-center gap-2 px-1">
            <ActiveCategoryIcon className="h-4 w-4 text-indigo-500 dark:text-indigo-300" />
            <div className="min-w-0">
              <p className="text-[13px] font-bold text-content">
                {t("dashboard:chatWorkspace.taskCategories." + activeCategory + ".label")}
              </p>
              <p className="mt-0.5 text-[12px] text-content-muted">
                {t("dashboard:chatWorkspace.taskCategoryHint")}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {TASK_EXAMPLE_IDS.map((taskId) => {
              const prompt = t("dashboard:chatWorkspace.taskCategories." + activeCategory + ".tasks." + taskId + ".prompt");
              return (
                <button
                  key={taskId}
                  type="button"
                  onClick={() => onUsePrompt(prompt)}
                  className="group min-h-[86px] rounded-xl border border-outline bg-surface-muted/80 p-3 text-left transition-all hover:border-indigo-200 hover:bg-indigo-50/60 hover:shadow-xs dark:hover:border-indigo-400/40 dark:hover:bg-indigo-500/10"
                >
                  <p className="line-clamp-2 text-[13px] font-semibold leading-5 text-content group-hover:text-indigo-700 dark:group-hover:text-indigo-200">
                    {t("dashboard:chatWorkspace.taskCategories." + activeCategory + ".tasks." + taskId + ".title")}
                  </p>
                  <p className="mt-1.5 line-clamp-2 text-[12px] leading-5 text-content-muted group-hover:text-content-muted">
                    {t("dashboard:chatWorkspace.taskCategories." + activeCategory + ".tasks." + taskId + ".desc")}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
