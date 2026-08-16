import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Globe, ChevronDown, Check } from "lucide-react";

export interface LanguageToggleProps {
  variant?: "fixed" | "inline" | "mobile";
  isDarkHero?: boolean;
}

const zhLabel = String.fromCodePoint(0x7b80, 0x4f53, 0x4e2d, 0x6587);
const chooseLanguageLabel = String.fromCodePoint(0x9009, 0x62e9, 0x8bed, 0x8a00);

export function LanguageToggle({ variant = "fixed", isDarkHero = false }: LanguageToggleProps) {
  const { t, i18n } = useTranslation("common");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const setLanguage = (lang: "zh-CN" | "en") => {
    i18n.changeLanguage(lang);
    try {
      localStorage.setItem("mybay_language", lang);
    } catch (_) {}
    setIsOpen(false);
  };

  const toggleLanguage = () => {
    const nextLang = i18n.language === "zh-CN" ? "en" : "zh-CN";
    setLanguage(nextLang);
  };

  useEffect(() => {
    if (variant !== "inline") return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [variant]);

  if (variant === "mobile") {
    const isZh = i18n.language === "zh-CN";
    return (
      <div className="w-full space-y-2 text-left">
        <span className="text-xs font-semibold text-[var(--mybay-text-muted)] tracking-wider uppercase block px-1">
          {isZh ? chooseLanguageLabel : "Language"}
        </span>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setLanguage("zh-CN")}
            className={`cursor-pointer flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-semibold transition-all border ${
              isZh
                ? "bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-400/30 text-blue-600 dark:text-blue-300 shadow-sm"
                : "bg-[var(--mybay-control-bg)] border-[var(--mybay-border-soft)] text-[var(--mybay-text-secondary)] hover:bg-[var(--mybay-control-hover-bg)] active:bg-[var(--mybay-nav-hover-bg)]"
            }`}
          >
            <span>{zhLabel}</span>
            {isZh && <Check className="w-4 h-4 shrink-0 text-blue-600 dark:text-blue-300" />}
          </button>
          <button
            type="button"
            onClick={() => setLanguage("en")}
            className={`cursor-pointer flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-semibold transition-all border ${
              !isZh
                ? "bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-400/30 text-blue-600 dark:text-blue-300 shadow-sm"
                : "bg-[var(--mybay-control-bg)] border-[var(--mybay-border-soft)] text-[var(--mybay-text-secondary)] hover:bg-[var(--mybay-control-hover-bg)] active:bg-[var(--mybay-nav-hover-bg)]"
            }`}
          >
            <span>English</span>
            {!isZh && <Check className="w-4 h-4 shrink-0 text-blue-600 dark:text-blue-300" />}
          </button>
        </div>
      </div>
    );
  }

  if (variant === "inline") {
    const isZh = i18n.language === "zh-CN";

    return (
      <div ref={containerRef} className="relative inline-block text-left">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`cursor-pointer flex h-9 items-center gap-1.5 px-3 rounded-xl border border-transparent text-[13px] font-medium transition-all duration-200 focus:outline-none select-none ${
            isOpen
              ? "bg-slate-100 dark:bg-slate-800 text-slate-950 dark:text-slate-50"
              : isDarkHero
                ? "text-white/85 hover:text-white hover:bg-white/10"
                : "bg-transparent text-slate-600 hover:text-slate-950 hover:bg-slate-100/80 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800/50"
          }`}
        >
          <Globe className="w-4 h-4 shrink-0" />
          <span>{isZh ? zhLabel : "English"}</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 shrink-0 ${isOpen ? "rotate-180" : ""}`} />
        </button>

        {isOpen && (
          <div className="absolute right-0 mt-2 w-40 rounded-xl bg-[var(--mybay-popover-bg)] border border-[var(--mybay-border-soft)] shadow-lg py-1.5 z-50 origin-top-right animate-in fade-in slide-in-from-top-1">
            <button
              type="button"
              onClick={() => setLanguage("zh-CN")}
              className={`cursor-pointer w-full text-left px-4 py-2 text-sm flex items-center justify-between transition-colors hover:bg-[var(--mybay-nav-hover-bg)] ${
                isZh ? "text-blue-600 dark:text-blue-300 font-bold bg-blue-50/40 dark:bg-blue-500/10" : "text-[var(--mybay-text-secondary)] font-medium"
              }`}
            >
              <span>{zhLabel}</span>
              {isZh && <Check className="w-4 h-4 text-blue-600 dark:text-blue-300" />}
            </button>
            <button
              type="button"
              onClick={() => setLanguage("en")}
              className={`cursor-pointer w-full text-left px-4 py-2 text-sm flex items-center justify-between transition-colors hover:bg-[var(--mybay-nav-hover-bg)] ${
                !isZh ? "text-blue-600 dark:text-blue-300 font-bold bg-blue-50/40 dark:bg-blue-500/10" : "text-[var(--mybay-text-secondary)] font-medium"
              }`}
            >
              <span>English</span>
              {!isZh && <Check className="w-4 h-4 text-blue-600 dark:text-blue-300" />}
            </button>
          </div>
        )}
      </div>
    );
  }

  if (typeof window !== "undefined" && window.location) {
    const path = window.location.pathname;
    if (path.includes("/login") || path.includes("/register")) {
      return null;
    }
  }

  return (
    <button
      type="button"
      onClick={toggleLanguage}
      className="fixed top-4 right-4 z-50 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[var(--mybay-text-secondary)] hover:text-[var(--mybay-text-primary)] bg-[var(--mybay-control-bg)] border border-[var(--mybay-border-soft)] hover:bg-[var(--mybay-control-hover-bg)] rounded-xl shadow-sm transition-all focus:outline-none cursor-pointer"
    >
      <Globe className="w-3.5 h-3.5 text-[var(--mybay-text-muted)]" />
      <span>{i18n.language === "zh-CN" ? t("english") : t("chinese")}</span>
    </button>
  );
}
