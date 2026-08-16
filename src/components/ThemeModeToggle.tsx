import { useEffect, useRef, useState } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ThemeMode, useTheme } from "./ThemeProvider";

const options: Array<{ mode: ThemeMode; Icon: typeof Monitor }> = [
  { mode: "system", Icon: Monitor },
  { mode: "light", Icon: Sun },
  { mode: "dark", Icon: Moon },
];

export function ThemeModeToggle() {
  const { t } = useTranslation("dashboard");
  const { mode, resolvedTheme, setMode } = useTheme();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const CurrentIcon = resolvedTheme === "dark" ? Moon : Sun;

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className={`inline-flex h-9 items-center gap-1.5 rounded-xl border border-transparent px-3 text-[13px] font-medium transition-all duration-200 focus:outline-none select-none cursor-pointer ${
          open
            ? "bg-slate-100 dark:bg-slate-800 text-slate-950 dark:text-slate-50"
            : "bg-transparent text-slate-600 hover:text-slate-950 hover:bg-slate-100/80 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800/50"
        }`}
        aria-label={t("theme.label")}
        title={t("theme.current", { mode: t(`theme.${mode}`) })}
      >
        <CurrentIcon className="h-4 w-4 shrink-0" />
        <span className="hidden xl:inline">{t(`theme.${mode}`)}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-40 overflow-hidden rounded-xl border border-[var(--mybay-border-soft)] bg-[var(--mybay-popover-bg)] p-1.5 shadow-xl">
          {options.map(({ mode: optionMode, Icon }) => {
            const active = optionMode === mode;
            return (
              <button
                key={optionMode}
                type="button"
                onClick={() => {
                  setMode(optionMode);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition ${
                  active
                    ? "bg-[var(--mybay-nav-active-bg)] text-[var(--mybay-text-primary)]"
                    : "text-[var(--mybay-text-secondary)] hover:bg-[var(--mybay-nav-hover-bg)] hover:text-[var(--mybay-text-primary)]"
                }`}
              >
                <span className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5" />
                  {t(`theme.${optionMode}`)}
                </span>
                {active && <Check className="h-3.5 w-3.5 text-indigo-500" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
