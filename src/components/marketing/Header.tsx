import { Link, useLocation } from "react-router-dom";
import { Menu, X, ArrowRight } from "lucide-react";
import { useState, useEffect } from "react";
import { Button, cn } from "../ui";
import { BrandLogo } from "../BrandLogo";
import { useTranslation } from "react-i18next";
import { LanguageToggle } from "../LanguageToggle";
import { ThemeModeToggle } from "../ThemeModeToggle";
import { normalizePath } from "../../lib/normalizePath";
import { MARKETING_DARK_HERO_PATHS } from "../../lib/constants";

export function MarketingHeader({ currentUser, authLoading }: { currentUser: any, authLoading?: boolean }) {
  const { t } = useTranslation("marketing");
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const path = normalizePath(location.pathname);

  const isDarkHero = !isScrolled && MARKETING_DARK_HERO_PATHS.includes(path);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    handleScroll(); // Sync immediately on mount (covers browser refresh with restored scroll position)
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Prevent scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
    }
    return () => {
      document.body.style.overflow = "auto";
    };
  }, [mobileMenuOpen]);

  return (
    <header 
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled ? "bg-header md:backdrop-blur-xl border-b border-outline py-4 md:py-5 shadow-sm" : "bg-transparent py-6 md:py-10"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4 relative">
        <Link to="/" className="flex items-center gap-2.5 group relative z-[60] shrink-0">
          <BrandLogo
            size="md"
            textColor={isDarkHero && !mobileMenuOpen ? "text-white" : "text-slate-900"}
            invertOnDark={!isDarkHero || mobileMenuOpen}
          />
        </Link>

        {/* Desktop Nav - Clean & minimal for OSS console */}
        <div className="hidden md:flex items-center gap-2.5 lg:gap-3 shrink-0">
          <ThemeModeToggle />
          <LanguageToggle variant="inline" isDarkHero={isDarkHero} />
          {authLoading ? (
            <div className={`w-32 h-10 rounded-full animate-pulse ${isDarkHero ? 'bg-white/10' : 'bg-slate-200/50'}`} />
          ) : currentUser ? (
            <Link to="/app">
              <Button className="group px-6 rounded-full shadow-md">
                {t("header.dashboard")}
                <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          ) : (
            <>
              {path === '/login' ? (
                <span className={`text-sm font-semibold px-4 py-2 cursor-default ${isDarkHero ? 'text-white' : 'text-blue-600 dark:text-blue-300'}`}>{t("header.login")}</span>
              ) : (
                <Link to="/login" className={`text-sm font-medium px-4 py-2 ${isDarkHero ? 'text-white/72 hover:text-white' : 'text-slate-600 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-300'}`}>{t("header.login")}</Link>
              )}
            </>
          )}
        </div>

        {/* Mobile menu button */}
        <button 
          className={`md:hidden p-2 relative z-[60] -mr-2 rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
            !mobileMenuOpen && isDarkHero
              ? "text-slate-200 hover:bg-white/10 hover:text-white"
              : "text-content-secondary hover:bg-control-hover hover:text-content"
          }`}
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-expanded={mobileMenuOpen}
          aria-label={mobileMenuOpen ? t("header.closeMenu") : t("header.openMenu")}
        >
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Nav Backdrop and Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div 
            className="absolute inset-0 bg-slate-950/55 dark:bg-black/70 backdrop-blur-sm transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="absolute top-0 left-0 right-0 bg-popover border-b border-outline pt-20 px-4 pb-6 shadow-2xl shadow-slate-950/15 dark:shadow-black/50 animate-in slide-in-from-top-4 duration-300 rounded-b-3xl">
            <div className="px-2 flex flex-col gap-4">
              <div className="flex justify-end px-1">
                <ThemeModeToggle />
              </div>
              <div className="p-1">
                <LanguageToggle variant="mobile" />
              </div>
              {authLoading ? (
                <div className="flex flex-col gap-4">
                  <div className="w-full h-12 bg-surface-muted animate-pulse rounded-2xl" />
                </div>
              ) : currentUser ? (
                <Link to="/app" className="block" onClick={() => setMobileMenuOpen(false)}>
                  <Button size="lg" className="w-full text-base rounded-2xl shadow-md">
                    {t("header.dashboard")}
                  </Button>
                </Link>
              ) : (
                <Link to="/login" onClick={() => setMobileMenuOpen(false)}>
                  <Button variant="outline" className="w-full h-12 text-base rounded-2xl font-medium">
                    {t("header.login")}
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
