import { HelpCircle, Rocket, CheckCircle2, BookOpen, Info, ChevronDown, ChevronRight, SquareArrowOutUpRight } from "lucide-react";
import { Button } from "../../components/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { channelSetupGuides, ChannelSetupGuide } from "@/shared/channelSetupGuides.registry";
import { channelSetupGuidesEn } from "@/shared/channelSetupGuides.en";

interface ChannelSetupGuidePanelProps {
  channelId: string;
}

function localizeGuide(base: ChannelSetupGuide, language?: string): ChannelSetupGuide {
  if (!language?.toLowerCase().startsWith("en")) return base;
  const translated = channelSetupGuidesEn[base.channelId];
  if (!translated) return base;

  return {
    ...base,
    title: translated.title,
    description: translated.description,
    estimatedTime: translated.estimatedTime,
    requiredItems: translated.requiredItems,
    steps: base.steps.map((step, index) => {
      const translatedStep = translated.steps[index];
      if (!translatedStep) return step;
      return {
        ...step,
        title: translatedStep.title,
        description: translatedStep.description,
        tip: translatedStep.tip,
        links: step.links?.map((link, linkIndex) => ({
          ...link,
          label: translatedStep.linkLabels?.[linkIndex] || link.label
        }))
      };
    })
  };
}

export function ChannelSetupGuidePanel({ channelId }: ChannelSetupGuidePanelProps) {
  const { t, i18n } = useTranslation("deploy");
  const [expandedSteps, setExpandedSteps] = useState(false);
  const sourceGuide = channelSetupGuides[channelId];
  const guide = sourceGuide ? localizeGuide(sourceGuide, i18n.resolvedLanguage) : undefined;

  if (!guide) {
    return (
      <div className="bg-surface-muted border border-outline rounded-xl p-6 text-center text-content-muted">
        <HelpCircle className="w-8 h-8 mx-auto mb-2 opacity-20" />
        <p className="text-[13px]">{t("wizardCopy.channelGuide.unavailable")}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-blue-100 bg-surface shadow-sm ring-4 ring-blue-50/50 dark:border-blue-800/70 dark:bg-slate-950/45 dark:ring-blue-950/35">
      <div className="bg-blue-600 p-4 text-white">
        <div className="flex items-center gap-2 mb-1">
          <Rocket className="w-4 h-4" />
          <h5 className="text-[13px] font-bold uppercase tracking-widest">{guide.title}</h5>
        </div>
        <p className="text-[11px] text-blue-100 opacity-90 leading-relaxed">
          {guide.description}
        </p>
      </div>

      <div className="p-4 space-y-5 overflow-y-auto max-h-[800px]">
        {/* Metadata */}
        <div className="flex items-center justify-between text-[11px] font-bold text-content-muted border-b border-outline pb-3">
          <div className="flex items-center gap-1.5 text-blue-600 dark:text-blue-300">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            <span>{t("wizardCopy.channelGuide.difficulty", { level: t(`wizardCopy.channelGuide.levels.${guide.difficulty}`) })}</span>
          </div>
          {guide.estimatedTime && (
            <div className="flex items-center gap-1.5">
              <span>{t("wizardCopy.channelGuide.estimatedTime", { time: guide.estimatedTime })}</span>
            </div>
          )}
        </div>

        {/* Requirements */}
        <div className="space-y-2">
          <span className="text-[11px] font-bold text-content-muted uppercase flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            <span>{t("wizardCopy.channelGuide.requirements")}</span>
          </span>
          <div className="flex flex-wrap gap-1.5">
            {guide.requiredItems.map((item, i) => (
              <span key={i} className="px-2 py-0.5 bg-surface-muted text-content-secondary rounded text-[11px] font-medium border border-outline">
                {item}
              </span>
            ))}
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-4 pt-2">
          <span className="text-[11px] font-bold text-content-muted uppercase flex items-center gap-1">
            <BookOpen className="w-3 h-3" />
            <span>{t("wizardCopy.channelGuide.steps")}</span>
          </span>

          <div className="space-y-3 relative">
            <div className="absolute left-[11px] top-4 bottom-4 w-0.5 bg-surface-muted z-0" />
            {(expandedSteps ? guide.steps : guide.steps.slice(0, 3)).map((step, idx) => (
              <div key={idx} className="relative z-10 flex gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-[11px] font-bold text-blue-600 shadow-sm dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300">
                  {idx + 1}
                </div>
                <div className="space-y-1.5 pt-0.5 flex-1">
                  <h6 className="text-[13px] font-bold text-content">{step.title}</h6>
                  <p className="text-[11px] text-content-muted leading-relaxed">
                    {step.description}
                  </p>

                  {step.links && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {step.links.map((link, li) => (
                        <Button
                          key={li}
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1.5 border-blue-200 bg-blue-50/50 px-2.5 text-[11px] text-blue-600 hover:bg-blue-100/50 dark:border-blue-800/70 dark:bg-blue-950/35 dark:text-blue-300 dark:hover:bg-blue-900/50"
                          onClick={() => window.open(link.url, link.external ? "_blank" : "_self", link.external ? "noopener,noreferrer" : undefined)}
                        >
                          <span>{link.label}</span>
                          {link.external && <SquareArrowOutUpRight className="w-2.5 h-2.5" />}
                        </Button>
                      ))}
                    </div>
                  )}

                  {step.fieldsToFill && (
                    <div className="bg-surface-muted rounded p-2 border border-outline flex items-start gap-1.5">
                      <Info className="w-3 h-3 text-content-muted mt-0.5" />
                      <div className="text-[9px] text-content-muted">
                        {t("wizardCopy.channelGuide.fillFields")}
                        <div className="flex flex-wrap gap-1 mt-1">
                          {step.fieldsToFill.map(f => (
                            <code key={f} className="bg-outline px-1 rounded text-content-secondary font-mono">{f}</code>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {step.tip && (
                    <p className="rounded border border-amber-100 bg-amber-50/50 p-1.5 text-[9px] italic text-amber-600 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300">
                      {t("wizardCopy.channelGuide.tip")}: {step.tip}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {guide.steps.length > 3 && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-[11px] text-content-muted hover:text-blue-600"
              onClick={() => setExpandedSteps(!expandedSteps)}
            >
              {expandedSteps ? <ChevronDown className="w-3 h-3 mr-1" /> : <ChevronRight className="w-3 h-3 mr-1" />}
              {expandedSteps ? t("wizardCopy.channelGuide.collapse") : t("wizardCopy.channelGuide.expand", { count: guide.steps.length - 3 })}
            </Button>
          )}
        </div>

        {/* Footer Links */}
        <div className="pt-4 border-t border-outline flex items-center justify-between">
          {guide.providerHomeUrl && (
            <Button
              variant="link"
              className="h-auto p-0 text-[11px] text-blue-600"
              onClick={() => window.open(guide.providerHomeUrl, "_blank", "noopener,noreferrer")}
            >
              {t("wizardCopy.channelGuide.officialHome")}
            </Button>
          )}
          <span className="text-[9px] text-content-muted">Guided Setup v1.0</span>
        </div>
      </div>
    </div>
  );
}
