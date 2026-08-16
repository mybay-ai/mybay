import React from "react";
import { useTranslation } from "react-i18next";
import { Cpu } from "lucide-react";

interface DetailPromptSectionProps {
  id: string;
  title: string;
  prompt: string;
  themeColor: "blue" | "amber";
}

export function DetailPromptSection({
  id,
  title,
  prompt,
  themeColor,
}: DetailPromptSectionProps) {
  const { t } = useTranslation("dashboard");
  const iconColorClass = themeColor === "blue" ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400";
  const codeBgClass = themeColor === "blue" ? "bg-slate-900 text-slate-300 border-slate-800 italic" : "bg-slate-950 text-emerald-400 border-slate-900";

  return (
    <div id={id} className="bg-surface rounded-2xl p-6 border border-slate-200/60 dark:border-slate-800 shadow-sm space-y-3 scroll-mt-4 text-left">
      <div className="flex items-center gap-2 text-content border-b border-outline pb-3">
        <Cpu className={`w-5 h-5 ${iconColorClass}`} />
        <h4 className="font-bold text-base text-content">{title}</h4>
      </div>
      {themeColor === "blue" ? (
        <div className={`p-4 ${codeBgClass} font-mono text-xs rounded-xl border leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap shadow-inner`}>
          "{prompt}"
        </div>
      ) : (
        <pre className={`p-4 ${codeBgClass} font-mono text-xs rounded-xl border leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap shadow-inner scrollbar-thin`}>
          {prompt || t("template_center.modal.workflow_default_prompt_notice", "系统自带高度优化的核心 logic，本工作流无需定制提示词。")}
        </pre>
      )}
    </div>
  );
}

