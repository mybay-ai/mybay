import React from "react";
import { Info } from "lucide-react";
import { normalizeLimitations } from "./utils";

interface DetailLimitationsSectionProps {
  id: string;
  title: string;
  limitations: any;
}

export function DetailLimitationsSection({ id, title, limitations }: DetailLimitationsSectionProps) {
  const list = normalizeLimitations(limitations);
  
  if (list.length === 0) {
    return null;
  }

  return (
    <div id={id} className="bg-amber-50/30 dark:bg-amber-950/10 rounded-2xl p-6 border border-amber-200/50 dark:border-amber-900/20 shadow-sm space-y-3 scroll-mt-4">
      <div className="flex items-center gap-2 text-amber-900 dark:text-amber-300 border-b border-amber-100 dark:border-amber-900/20 pb-3 border-dashed">
        <Info className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
        <h4 className="font-bold text-base text-amber-900 dark:text-amber-200">{title}</h4>
      </div>
      <ul className="space-y-2">
        {list.map((item, idx) => (
          <li key={idx} className="flex items-start gap-2 text-xs text-content-secondary leading-relaxed font-medium text-left">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0 mt-1.5" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
