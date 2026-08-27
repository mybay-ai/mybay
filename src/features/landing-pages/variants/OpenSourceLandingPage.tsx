import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  CheckCircle2,
  TerminalSquare,
  Copy,

  Server,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { Button } from "../../../components/ui";

const quickStartCommand = `git clone https://github.com/mybay-ai/mybay-core.git
cd mybay-core
bash quick-start.sh`;

function CommandBlock({ command, label }: { command: string; label: string }) {
  const { t } = useTranslation("marketing");
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 text-left shadow-xl">
      <div className="flex min-w-0 items-center justify-between gap-3 border-b border-slate-800 px-3 py-3 sm:px-4">
        <span className="min-w-0 truncate text-xs font-semibold text-slate-400">{label}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-slate-800 hover:text-white sm:px-2.5"
        >
          <Copy className="h-3.5 w-3.5" />
          {t(copied ? "openSourceLanding.commands.copied" : "openSourceLanding.commands.copy")}
        </button>
      </div>
      <pre className="max-w-full overflow-x-auto overscroll-x-contain p-4 text-sm leading-7 text-emerald-300 sm:p-5">
        <code className="block min-w-max">{command}</code>
      </pre>
    </div>
  );
}

export function OpenSourceLandingPage() {
  const { t } = useTranslation("marketing");
  const manualDockerCommand = `cp .env.example .env
# ${t("openSourceLanding.commands.editEnvComment")}
docker compose up -d --build
docker compose ps`;
  return (
    <div className="overflow-x-hidden bg-surface-muted pt-20 text-content transition-colors duration-200">
      <section className="relative px-4 py-20 sm:py-28 lg:py-32">
        <div className="pointer-events-none absolute inset-x-0 top-0 mx-auto h-[420px] max-w-5xl rounded-full bg-blue-200/40 dark:bg-blue-600/15 blur-3xl" />
        <div className="relative mx-auto max-w-6xl text-center">
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-blue-200 dark:border-blue-800/70 bg-surface/80 px-4 py-2 text-sm font-semibold text-blue-700 dark:text-blue-300 shadow-sm backdrop-blur">
            <ShieldCheck className="h-4 w-4" />
            {t("openSourceLanding.hero.badge")}
          </div>
          <h1 className="mx-auto max-w-4xl text-4xl font-black tracking-tight text-content sm:text-5xl lg:text-7xl">
            {t("openSourceLanding.hero.titlePrefix")}
            <span className="text-blue-600"> {t("openSourceLanding.hero.titleHighlight")}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-8 text-content-secondary sm:text-lg">
            {t("openSourceLanding.hero.description")}
          </p>

          <div className="mx-auto mt-12 grid max-w-5xl gap-6 text-left md:grid-cols-2">
            <article className="flex flex-col rounded-3xl border border-blue-200 dark:border-blue-800/70 bg-surface p-7 shadow-xl shadow-blue-100/60 dark:shadow-black/30 sm:p-9">
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-200">
                <TerminalSquare className="h-7 w-7" />
              </div>
              <div className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-blue-600">{t("openSourceLanding.cloud.eyebrow")}</div>
              <h2 className="text-2xl font-black">{t("openSourceLanding.cloud.title")}</h2>
              <p className="mt-3 flex-1 leading-7 text-content-secondary">
                {t("openSourceLanding.cloud.description")}
              </p>
              <ul className="my-6 space-y-3 text-sm text-content-secondary">
                {[t("openSourceLanding.cloud.benefits.noInstall"), t("openSourceLanding.cloud.benefits.noOps"), t("openSourceLanding.cloud.benefits.managedUpdates")].map(item => (
                  <li key={item} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" />{item}</li>
                ))}
              </ul>
              <a href="#self-host">
                <Button size="xl" className="w-full rounded-2xl">
                  {t("openSourceLanding.cloud.action")} <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </a>
            </article>

            <article className="flex flex-col rounded-3xl border border-outline bg-surface p-7 shadow-xl shadow-slate-200/60 dark:shadow-black/30 sm:p-9">
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg shadow-slate-300">
                <Server className="h-7 w-7" />
              </div>
              <div className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-slate-500">{t("openSourceLanding.selfHost.eyebrow")}</div>
              <h2 className="text-2xl font-black">{t("openSourceLanding.selfHost.title")}</h2>
              <p className="mt-3 flex-1 leading-7 text-content-secondary">
                {t("openSourceLanding.selfHost.description")}
              </p>
              <ul className="my-6 space-y-3 text-sm text-content-secondary">
                {[t("openSourceLanding.selfHost.benefits.ownData"), t("openSourceLanding.selfHost.benefits.ownKeys"), t("openSourceLanding.selfHost.benefits.advancedDocker")].map(item => (
                  <li key={item} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" />{item}</li>
                ))}
              </ul>
              <a href="#self-host">
                <Button size="xl" variant="outline" className="w-full rounded-2xl border-outline-strong bg-surface">
                  {t("openSourceLanding.selfHost.action")} <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </a>
            </article>
          </div>
        </div>
      </section>

      <section id="self-host" className="scroll-mt-24 border-t border-outline bg-surface px-4 py-20 sm:py-28">
        <div className="mx-auto min-w-0 max-w-6xl">
          <div className="mx-auto mb-12 max-w-3xl text-center">
            <div className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">{t("openSourceLanding.deployment.eyebrow")}</div>
            <h2 className="mt-3 text-3xl font-black sm:text-4xl">{t("openSourceLanding.deployment.title")}</h2>
            <p className="mt-4 leading-7 text-content-secondary">
              {t("openSourceLanding.deployment.description")}
            </p>
          </div>

          <div className="grid min-w-0 gap-6 sm:gap-8 lg:grid-cols-2">
            <article className="min-w-0 rounded-3xl border-2 border-blue-500 bg-blue-50/50 p-5 dark:border-blue-400 dark:bg-blue-950/30 sm:p-8">
              <div className="mb-5 flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="rounded-xl bg-blue-600 p-2.5 text-white"><Terminal className="h-5 w-5" /></div>
                  <div>
                    <div className="text-xs font-black text-blue-600">{t("openSourceLanding.deployment.quick.recommended")}</div>
                    <h3 className="break-words text-xl font-black">{t("openSourceLanding.deployment.quick.title")}</h3>
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700 dark:bg-blue-950/70 dark:text-blue-300">{t("openSourceLanding.deployment.quick.audience")}</span>
              </div>
              <p className="mb-5 text-sm leading-7 text-content-secondary">
                {t("openSourceLanding.deployment.quick.description")}
              </p>
              <CommandBlock command={quickStartCommand} label={t("openSourceLanding.commands.quickLabel")} />
            </article>

            <article className="min-w-0 rounded-3xl border border-outline bg-surface-muted p-5 sm:p-8">
              <div className="mb-5 flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="rounded-xl bg-slate-900 p-2.5 text-white"><Server className="h-5 w-5" /></div>
                  <div>
                    <div className="text-xs font-black text-slate-500">{t("openSourceLanding.deployment.manual.mode")}</div>
                    <h3 className="break-words text-xl font-black">{t("openSourceLanding.deployment.manual.title")}</h3>
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-control-hover px-3 py-1 text-xs font-bold text-content-secondary">{t("openSourceLanding.deployment.manual.audience")}</span>
              </div>
              <p className="mb-5 text-sm leading-7 text-content-secondary">
                {t("openSourceLanding.deployment.manual.description")}
              </p>
              <CommandBlock command={manualDockerCommand} label={t("openSourceLanding.commands.manualLabel")} />
            </article>
          </div>

          <div className="mt-10 grid min-w-0 gap-4 rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200 sm:p-6 md:grid-cols-3">
            <div><strong>{t("openSourceLanding.requirements.environmentTitle")}</strong><br />{t("openSourceLanding.requirements.environmentValue")}</div>
            <div><strong>{t("openSourceLanding.requirements.resourcesTitle")}</strong><br />{t("openSourceLanding.requirements.resourcesValue")}</div>
            <div><strong>{t("openSourceLanding.requirements.accessTitle")}</strong><br />{t("openSourceLanding.requirements.accessValue")}</div>
          </div>
        </div>
      </section>
    </div>
  );
}
