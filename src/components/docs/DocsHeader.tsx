import { BookOpen, ChevronDown, ExternalLink, Menu, Monitor, Moon, Search, Sun } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useTheme, type ThemeMode } from "../ThemeProvider";
import type { DocsLocale } from "../../lib/docs/docsTypes";

export function DocsHeader({ onMenu, onSearch }: { onMenu: () => void; onSearch: () => void }) {
  const { t, i18n } = useTranslation("docs");
  const { mode, setMode } = useTheme();
  const locale: DocsLocale = i18n.language === "zh-CN" ? "zh-CN" : "en";
  const themeIcons: Record<ThemeMode, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };
  const ThemeIcon = themeIcons[mode];

  return (
    <header className="docs-v2-header">
      <div className="docs-v2-header-inner">
        <button type="button" className="docs-mobile-menu-button" onClick={onMenu} aria-label={t("openMenu")}><Menu aria-hidden="true" /></button>
        <Link to="/docs" className="docs-brand"><BookOpen aria-hidden="true" /><span>{t("brand")}</span></Link>
        <button type="button" className="docs-header-search" onClick={onSearch}><Search aria-hidden="true" /><span>{t("searchDocs")}</span><kbd>{t("searchShortcut")}</kbd></button>
        <div className="docs-header-actions">
          <label className="docs-header-select"><span className="sr-only">{t("language")}</span><select value={locale} onChange={event => i18n.changeLanguage(event.target.value)}><option value="zh-CN">{t("languageChinese")}</option><option value="en">{t("languageEnglish")}</option></select><ChevronDown aria-hidden="true" /></label>
          <label className="docs-header-select"><span className="sr-only">{t("appearance")}</span><ThemeIcon aria-hidden="true" /><select value={mode} onChange={event => setMode(event.target.value as ThemeMode)}><option value="light">{t("themeLight")}</option><option value="dark">{t("themeDark")}</option><option value="system">{t("themeSystem")}</option></select><ChevronDown aria-hidden="true" /></label>
          <Link to="/" className="docs-back-link"><span>{t("backHome")}</span><ExternalLink aria-hidden="true" /></Link>
        </div>
      </div>
    </header>
  );
}
