import { MarketingHeader } from "./Header";
import { MarketingFooter } from "./Footer";
import { BackToTop } from "../BackToTop";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { normalizePath } from "../../lib/normalizePath";
import { MARKETING_DARK_HERO_PATHS } from "../../lib/constants";

interface MarketingLayoutProps {
  children: React.ReactNode;
  currentUser: any;
  authLoading?: boolean;
}

export function MarketingLayout({ children, currentUser, authLoading }: MarketingLayoutProps) {
  const { pathname } = useLocation();
  const path = normalizePath(pathname);

  useEffect(() => {
    if (!MARKETING_DARK_HERO_PATHS.includes(path)) return;

    const prev = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    window.scrollTo(0, 0);
    return () => {
      window.history.scrollRestoration = prev;
    };
  }, [path]);
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans selection:bg-blue-500 selection:text-white transition-colors duration-200">
      <MarketingHeader currentUser={currentUser} authLoading={authLoading} />
      <main className="relative z-0">
        {children}
      </main>
      <MarketingFooter />
      <BackToTop />
    </div>
  );
}
