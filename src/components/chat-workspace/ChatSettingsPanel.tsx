import { Brain, Gauge, HelpCircle, Sparkles, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

type ReasoningEffort = "fast" | "balanced" | "deep";

interface ChatSettingsPanelProps {
  temperature: number;
  setTemperature: (temperature: number) => void;
  reasoningEffort: ReasoningEffort;
  setReasoningEffort: (effort: ReasoningEffort) => void;
  chatMode: "quick" | "assist" | "agent";
  selectedSkillId: string;
  setSelectedSkillId: (skillId: string) => void;
}

export function ChatSettingsPanel({
  temperature,
  setTemperature,
  reasoningEffort,
  setReasoningEffort,
  chatMode,
  selectedSkillId,
  setSelectedSkillId
}: ChatSettingsPanelProps) {
  const { t } = useTranslation("dashboard");

  const reasoningOptions = [
    { id: "fast" as const, label: t("chatWorkspace.reasoningEffortFast"), desc: t("chatWorkspace.reasoningEffortFastDesc"), icon: Zap },
    { id: "balanced" as const, label: t("chatWorkspace.reasoningEffortBalanced"), desc: t("chatWorkspace.reasoningEffortBalancedDesc"), icon: Gauge },
    { id: "deep" as const, label: t("chatWorkspace.reasoningEffortDeep"), desc: t("chatWorkspace.reasoningEffortDeepDesc"), icon: Brain }
  ];

  const getTemperatureModeLabel = () => {
    if (temperature <= 0.4) return t("chatWorkspace.temperaturePresetStrict");
    if (temperature >= 1.1) return t("chatWorkspace.temperaturePresetCreative");
    return t("chatWorkspace.temperaturePresetBalanced");
  };

  return (
    <div className="bg-surface/95 border-b border-outline px-4 py-3 animate-slide-in select-none shrink-0">
      <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:gap-5">
        {chatMode === "assist" && (
          <div className="min-w-0 2xl:w-72 animate-fade-in shrink-0">
            <div className="mb-1.5 text-[13px] font-semibold uppercase tracking-wide text-content-muted">{t("chatWorkspace.assistSkillLabel")}</div>
            <select value={selectedSkillId} onChange={(e) => setSelectedSkillId(e.target.value)} className="block h-10 w-full rounded-xl border border-outline bg-surface-muted px-3 text-[13px] font-semibold text-content-secondary shadow-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
              <option value="model_config_diagnosis">{t("chatWorkspace.assistSkillModelConfigDiagnosis")}</option>
              <option value="explain_last_error">{t("chatWorkspace.assistSkillExplainLastError")}</option>
              <option value="instance_health_summary">{t("chatWorkspace.assistSkillInstanceHealthSummary")}</option>
              <option value="summarize_conversation">{t("chatWorkspace.assistSkillSummarizeConversation")}</option>
            </select>
          </div>
        )}

        <div className="min-w-0 flex-1 space-y-4">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <section className="rounded-xl border border-outline bg-surface-muted/70 p-3">
              <div className="flex items-start gap-2">
                <div className="mt-0.5 rounded-lg bg-indigo-50 p-1.5 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-200"><Brain className="h-4 w-4" /></div>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-content">{t("chatWorkspace.reasoningPanelTitle")}</div>
                  <div className="mt-0.5 text-[12px] leading-relaxed text-content-muted">{t("chatWorkspace.reasoningPanelSubtitle")}</div>
                </div>
              </div>
              <div className="mt-3 grid gap-1.5 sm:grid-cols-3">
                {reasoningOptions.map((option) => {
                  const Icon = option.icon;
                  const active = reasoningEffort === option.id;
                  return (
                    <button key={option.id} type="button" onClick={() => setReasoningEffort(option.id)} className={["rounded-lg border px-2.5 py-2 text-left transition-all", active ? "border-indigo-300 bg-white text-indigo-700 shadow-xs dark:border-indigo-400/50 dark:bg-indigo-500/15 dark:text-indigo-100" : "border-outline bg-surface/70 text-content-secondary hover:border-indigo-200 hover:text-indigo-700 dark:hover:border-indigo-400/40 dark:hover:text-indigo-200"].join(" ")} title={option.desc}>
                      <span className="flex items-center gap-1.5 text-[13px] font-semibold"><Icon className="h-3.5 w-3.5 shrink-0" />{option.label}</span>
                      <span className="mt-1 block text-[11px] leading-4 opacity-75">{option.desc}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="rounded-xl border border-outline bg-surface-muted/70 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[13px] font-semibold text-content"><Sparkles className="h-3.5 w-3.5 text-slate-400" />{t("chatWorkspace.temperaturePanelTitle")}</div>
                  <div className="mt-1 text-[12px] leading-relaxed text-content-muted">{t("chatWorkspace.temperaturePanelSubtitle")}</div>
                </div>
                <span className="text-[13px] font-mono font-semibold bg-surface px-2 py-0.5 rounded border border-outline text-content-secondary">{temperature.toFixed(1)}</span>
              </div>
              <div className="mt-3 space-y-2">
                <input type="range" min="0" max="2" step="0.1" value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))} className="w-full h-1.5 bg-outline rounded-lg appearance-none cursor-pointer accent-indigo-600 focus:outline-none" />
                <div className="flex items-center justify-between gap-2 text-[12px] text-content-muted">
                  <span>{t("chatWorkspace.temperaturePresetStrict")}</span>
                  <span className="rounded-full bg-surface border border-outline px-2 py-0.5 font-semibold text-content-secondary">{getTemperatureModeLabel()}</span>
                  <span>{t("chatWorkspace.temperaturePresetCreative")}</span>
                </div>
              </div>
            </section>
          </div>

          <div className="flex items-start gap-2 text-[13px] text-content-muted">
            <HelpCircle className="w-3.5 h-3.5 shrink-0 text-content-muted mt-0.5" />
            <span className="leading-relaxed">{t("chatWorkspace.temperatureDesc")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
