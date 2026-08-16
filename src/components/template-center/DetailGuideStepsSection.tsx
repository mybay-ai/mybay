import React from "react";
import { BookOpen } from "lucide-react";

interface DetailGuideStepsSectionProps {
  id: string;
  title: string;
  steps: string[];
  themeColor: "blue" | "amber";
}

export function DetailGuideStepsSection({ id, title, steps, themeColor }: DetailGuideStepsSectionProps) {
  if (!steps || steps.length === 0) {
    return null;
  }

  const iconColorClass = themeColor === "blue" ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400";
  const badgeColorClass = themeColor === "blue"
    ? "bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border-blue-100 dark:border-blue-900/30"
    : "bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-900/30";
  const textColorClass = themeColor === "blue"
    ? "text-sm text-content-secondary font-medium py-0.5"
    : "text-xs text-content-secondary font-medium py-0.5 leading-relaxed";

  return (
    <div id={id} className="bg-surface rounded-2xl p-6 border border-slate-200/60 dark:border-slate-800 shadow-sm space-y-4 scroll-mt-4 text-left">
      <div className="flex items-center gap-2 text-content border-b border-outline pb-3">
        <BookOpen className={`w-5 h-5 ${iconColorClass}`} />
        <h4 className="font-bold text-base text-content">{title}</h4>
      </div>
      <div className="relative pl-2 space-y-4">
        {steps.map((item, idx) => (
          <div key={idx} className="flex gap-4 relative text-left">
            <div className="flex flex-col items-center shrink-0">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs border ${badgeColorClass}`}>
                {idx + 1}
              </span>
              {idx < steps.length - 1 && (
                <div className="w-px bg-slate-200 dark:bg-slate-800 grow my-1" />
              )}
            </div>
            <p className={textColorClass}>{item}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
