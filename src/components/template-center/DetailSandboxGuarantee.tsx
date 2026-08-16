import React from "react";
import { Shield } from "lucide-react";

interface DetailSandboxGuaranteeProps {
  text: string;
}

export function DetailSandboxGuarantee({ text }: DetailSandboxGuaranteeProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 bg-control-hover rounded-xl text-[11px] text-content-muted font-medium border border-slate-200/60 dark:border-slate-800 text-left">
      <Shield className="w-4 h-4 text-content-muted shrink-0" />
      <span>{text}</span>
    </div>
  );
}
