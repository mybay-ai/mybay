import { Check, CheckCircle2, AlertTriangle, Circle } from "lucide-react";

export type StepStatus = "pending" | "current" | "completed" | "error";

interface StepInfo {
  title: string;
  desc: string;
}

interface WizardStepperProps {
  steps: StepInfo[];
  currentStep: number;
  statuses: StepStatus[];
  onStepClick: (stepIndex: number) => void;
}

export function WizardStepper({ steps, currentStep, statuses, onStepClick }: WizardStepperProps) {
  return (
    <div className="w-full">
      {/* Mobile view (< md): Horizontal scrollable steps tabs */}
      <div className="md:hidden flex border-b border-outline overflow-x-auto hide-scrollbar bg-surface-muted/50">
        <div className="flex px-4 py-2 gap-4 min-w-max">
          {steps.map((s, i) => {
            const status = statuses[i];
            const isActive = currentStep === i;
            const isCompleted = status === "completed";
            const isError = status === "error";

            return (
              <button
                key={i}
                type="button"
                onClick={() => i < currentStep && onStepClick(i)}
                disabled={i >= currentStep && status !== "completed"}
                className={`flex items-center gap-1.5 py-1.5 px-3 rounded-full text-[13px] font-medium transition-all ${
                  isActive
                    ? "bg-blue-600 text-white shadow-sm"
                    : isError
                    ? "bg-red-50 dark:bg-rose-950/25 text-red-600 dark:text-rose-400 border border-red-200 dark:border-rose-900/50 hover:bg-red-100 dark:hover:bg-rose-900/40"
                    : isCompleted
                    ? "bg-emerald-50 dark:bg-emerald-950/25 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                    : "bg-surface text-content-muted border border-outline hover:bg-surface-muted opacity-70"
                }`}
              >
                <span>{i + 1}. {s.title}</span>
                {isCompleted && <Check className="w-3.5 h-3.5" />}
                {isError && <AlertTriangle className="w-3.5 h-3.5" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Desktop view (>= md): Full vertical flow */}
      <div className="hidden md:flex flex-col gap-2 p-3 py-4">
        {steps.map((s, i) => {
          const status = statuses[i];
          const isActive = currentStep === i;
          const isCompleted = status === "completed";
          const isError = status === "error";

          // Icon or Number element
          let indicator;
          if (isCompleted) {
            indicator = (
              <div className={`flex items-center justify-center w-8 h-8 rounded-full shrink-0 transition-all bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400`}>
                <Check className="w-4 h-4 stroke-[2.5]" />
              </div>
            );
          } else if (isError) {
            indicator = (
              <div className={`flex items-center justify-center w-8 h-8 rounded-full shrink-0 transition-all bg-red-100 dark:bg-rose-950/50 text-red-700 dark:text-rose-400`}>
                <AlertTriangle className="w-4 h-4" />
              </div>
            );
          } else if (isActive) {
            indicator = (
              <div className={`flex items-center justify-center w-8 h-8 rounded-full shrink-0 transition-all bg-blue-600 text-white font-bold text-sm ring-4 ring-blue-100 dark:ring-blue-950/50`}>
                {i + 1}
              </div>
            );
          } else {
            indicator = (
              <div className={`flex items-center justify-center w-8 h-8 rounded-full shrink-0 transition-all bg-surface-muted text-content-muted font-bold text-sm border border-outline`}>
                {i + 1}
              </div>
            );
          }

          return (
            <button
              key={i}
              type="button"
              onClick={() => i < currentStep && onStepClick(i)}
              disabled={i >= currentStep && status !== "completed"}
              className={`group flex items-center gap-3.5 p-3 rounded-xl text-left border transition-all min-h-[64px] ${
                isActive
                  ? "bg-blue-50/50 dark:bg-blue-950/35 border-blue-200 dark:border-blue-900/50 text-blue-700 dark:text-blue-400 shadow-sm relative"
                  : isError
                  ? "bg-red-50/40 dark:bg-rose-950/25 hover:bg-red-50 dark:hover:bg-rose-900/20 border-red-100 dark:border-rose-900/50 hover:border-red-200 dark:hover:border-rose-800 cursor-pointer"
                  : isCompleted
                  ? "bg-emerald-50/10 dark:bg-emerald-950/10 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/30 border-emerald-100/50 dark:border-emerald-900/50 hover:border-emerald-200 dark:hover:border-emerald-800 cursor-pointer"
                  : "bg-transparent border-transparent cursor-not-allowed"
              }`}
            >
              {indicator}
              <div className="flex-1 min-w-0 flex flex-col justify-center">
                <p className={`text-sm font-semibold block ${isActive ? "text-blue-800 dark:text-blue-300" : isCompleted ? "text-content" : isError ? "text-red-800 dark:text-red-400" : "text-content-secondary"}`}>
                  {s.title}
                </p>
                <p className={`text-[13px] mt-0.5 truncate ${isActive ? "text-blue-600 dark:text-blue-400" : isCompleted ? "text-content-muted" : isError ? "text-red-500 dark:text-rose-400" : "text-content-muted"}`}>
                  {s.desc}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

