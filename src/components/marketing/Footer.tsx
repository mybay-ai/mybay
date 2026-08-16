import { Link } from "react-router-dom";
import { Github, Mail } from "lucide-react";
import { BrandLogo } from "../BrandLogo";
import { useTranslation } from "react-i18next";

export function MarketingFooter() {
  const { t } = useTranslation("marketing");
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-surface-muted border-t border-outline transition-colors duration-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-center md:text-left">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-2">
              <BrandLogo size="sm" textColor="text-slate-900" invertOnDark />
            </Link>
            <p className="text-xs text-content-muted">
              &copy; {currentYear} {t("footer.copyright")}
            </p>
          </div>
          <div className="flex justify-center flex-wrap gap-4 md:gap-6">
            <Link to="/security" className="text-xs text-content-muted hover:text-content-secondary transition-colors p-1">{t("footer.security", { defaultValue: "Security" })}</Link>
            <Link to="/privacy" className="text-xs text-content-muted hover:text-content-secondary transition-colors p-1">{t("footer.privacy")}</Link>
            <Link to="/terms" className="text-xs text-content-muted hover:text-content-secondary transition-colors p-1">{t("footer.terms")}</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

