import { ChevronRight, ArrowLeft, X, Play, Loader2, AlertCircle } from "lucide-react";
import { Button } from "../../components/ui";
import { useTranslation } from "react-i18next";

interface WizardFooterProps {
  step: number;
  loading: boolean;
  onPrev: () => void;
  onNext: () => void;
  onCancel: () => void;
  onSubmit: () => void;
  nextDisabled: boolean;
  disableReason: string | null;
  statusMessage?: { text: string; type: "error" | "warning" | "success" | "info" } | null;
}

export function WizardFooter({
  step,
  loading,
  onPrev,
  onNext,
  onCancel,
  onSubmit,
  nextDisabled,
  disableReason,
  statusMessage
}: WizardFooterProps) {
  const { t } = useTranslation("deploy");
  if (step === 7) return null; // Complete step doesn't show standard navigation footer

  const isLastStep = step === 6;

  // Render status alert style
  let alertStyle = "text-content-muted bg-surface-muted/50 border-outline/80";
  let dotStyle = "bg-slate-400";

  if (statusMessage) {
    if (statusMessage.type === "error") {
      alertStyle = "text-red-700 dark:text-red-400 bg-red-50/60 dark:bg-rose-950/25 border-red-100 dark:border-rose-900/40";
      dotStyle = "bg-red-500 animate-pulse";
    } else if (statusMessage.type === "warning") {
      alertStyle = "text-amber-700 dark:text-amber-400 bg-amber-50/60 dark:bg-amber-950/25 border-amber-100 dark:border-amber-900/40";
      dotStyle = "bg-amber-500";
    } else if (statusMessage.type === "success") {
      alertStyle = "text-emerald-700 dark:text-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/25 border-emerald-100 dark:border-emerald-900/40";
      dotStyle = "bg-emerald-500";
    } else {
      alertStyle = "text-blue-700 dark:text-blue-400 bg-blue-50/60 dark:bg-blue-950/25 border-blue-100 dark:border-blue-900/40";
      dotStyle = "bg-blue-500";
    }
  } else if (disableReason) {
    alertStyle = "text-red-700 dark:text-red-400 bg-red-50/60 dark:bg-rose-950/25 border-red-100 dark:border-rose-900/40";
    dotStyle = "bg-red-500 animate-pulse";
  }

  return (
    <div className="flex flex-col sm:flex-row justify-between items-center sm:h-[72px] bg-surface/95 backdrop-blur-sm border-t border-outline/80 p-4 sm:px-8 sm:py-0 gap-3 shrink-0 shadow-[0_-4px_12px_rgba(0,0,0,0.03)] z-20 w-full sticky bottom-0 sm:relative pb-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:pb-0">
      {/* Left side context status or reasons */}
      <div className="w-full sm:flex-1 text-content-secondary text-sm md:text-[13px] text-center sm:text-left min-w-0 order-2 sm:order-1">
        <div className={`inline-flex w-full sm:w-auto items-center justify-center sm:justify-start gap-2 px-3 py-1.5 rounded-xl border ${alertStyle} truncate max-w-full font-bold text-[13px] tracking-tight`}>
          <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dotStyle}`} />
          <span className="truncate">
            {statusMessage ? statusMessage.text : disableReason ? disableReason : t("wizardCopy.footer.ready")}
          </span>
        </div>
      </div>

      {/* Right side controls */}
      <div className="flex flex-row items-center gap-2 w-full sm:w-auto sm:justify-end shrink-0 order-1 sm:order-2">
        {step > 0 && (
          <Button
            type="button"
            variant="outline"
            onClick={onPrev}
            disabled={loading}
            className="flex-1 sm:flex-none text-content-secondary border-outline bg-surface hover:bg-surface-muted shrink-0 h-11 sm:h-10 px-4 text-sm font-bold flex items-center justify-center sm:justify-start gap-1.5 transition-all rounded-xl"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("wizardCopy.footer.previous")}
          </Button>
        )}

        {isLastStep ? (
          <Button
            type="button"
            onClick={onSubmit}
            disabled={loading || nextDisabled}
            className={`flex-[2] sm:flex-none bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-200 dark:shadow-none font-bold h-11 sm:h-10 min-w-[140px] px-6 flex items-center justify-center gap-2 text-sm shrink-0 transition-all rounded-xl ${nextDisabled || loading ? 'opacity-50 grayscale cursor-not-allowed' : 'active:scale-[0.98]'}`}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{t("wizardCopy.footer.deploying")}</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current text-white/90" />
                <span>{t("wizardCopy.footer.start")}</span>
              </>
            )}
          </Button>
        ) : (
          <Button
            type="button"
            onClick={onNext}
            disabled={nextDisabled}
            className={`flex-[2] sm:flex-none bg-slate-900 dark:bg-slate-100 border-slate-800 dark:border-slate-200 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200 h-11 sm:h-10 min-w-[120px] px-6 flex items-center justify-center gap-1.5 text-sm font-bold shrink-0 transition-all rounded-xl ${nextDisabled ? 'opacity-40 cursor-not-allowed bg-slate-400 dark:bg-slate-800 border-transparent' : 'active:scale-[0.98]'}`}
            title={nextDisabled && disableReason ? disableReason : undefined}
          >
            <span>{t("wizardCopy.footer.next")}</span>
            <ChevronRight className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

