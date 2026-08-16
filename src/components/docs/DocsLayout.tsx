import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getStructuredDocById } from "../../data/docs/docs.registry";
import { DocsErrorBoundary } from "./DocsUI";
import { Menu, X, Search, ChevronRight, Hash, BookOpen } from "lucide-react";
import { Button } from "../ui";
import { cn } from "../ui";

export interface NavItem {
  id: string;
  title: string;
  isNew?: boolean;
}

export interface NavGroup {
  group: string;
  items: NavItem[];
}

interface DocsLayoutProps {
  navConfig: NavGroup[];
  activeId: string;
  onNavigate: (id: string) => void;
  breadcrumbs: string[];
  title: string;
  description?: string;
  meta?: { label: string; value: string }[];
  children: React.ReactNode;
}

export function DocsLayout({
  navConfig,
  activeId,
  onNavigate,
  breadcrumbs,
  title,
  description,
  meta,
  children
}: DocsLayoutProps) {
  const { t, i18n } = useTranslation("marketing");
  const isZh = i18n.language === "zh-CN";
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const location = useLocation();
  const isAppMode = location.pathname.startsWith("/app");

  const getItemUrl = (itemId: string) => {
    if (isAppMode) {
      return `/app/guides?guide=${itemId}`;
    }
    const structured = getStructuredDocById(itemId);
    if (structured) {
      return `/docs/${structured.slug}`;
    }
    return `/docs?guide=${itemId}`;
  };
  const [headings, setHeadings] = useState<{ id: string; text: string; level: number }[]>([]);
  const [activeHeadingId, setActiveHeadingId] = useState<string>("");
  const contentRef = useRef<HTMLDivElement>(null);

  // Auto-generate TOC from h2 and h3
  useEffect(() => {
    if (!contentRef.current) return;
    
    // Give time for content to render
    const timer = setTimeout(() => {
      const headingElements = contentRef.current?.querySelectorAll("h2, h3") || [];
      const newHeadings = Array.from(headingElements).map((el, index) => {
        // Ensure element has a clean, unique id
        if (!el.id) {
          const cleanText = el.textContent?.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '') || '';
          el.id = `heading-${index}-${cleanText}`;
        }
        return {
          id: el.id,
          text: el.textContent || "",
          level: el.tagName === "H2" ? 2 : 3
        };
      });
      setHeadings(newHeadings);
    }, 100);
    
    return () => clearTimeout(timer);
  }, [children, activeId]);

  // TOC scroll spy supporting nested scrollable container in DashboardLayout and normal window scrolling
  useEffect(() => {
    let scrollContainer: HTMLElement | Window = window;

    const handleScroll = () => {
      if (headings.length === 0) return;
      
      let currentHeading = headings[0].id;
      for (const heading of headings) {
        const el = document.getElementById(heading.id);
        if (el) {
          const rect = el.getBoundingClientRect();
          // Elements passing the top viewport fold (with offset for sticky headers)
          if (rect.top <= 150) {
            currentHeading = heading.id;
          } else {
            break;
          }
        }
      }
      setActiveHeadingId(currentHeading);
    };

    // Find the closest custom scrollable parent (if we are inside the dashboard's scroll view)
    if (contentRef.current) {
      const scrollParent = contentRef.current.closest(".overflow-y-auto");
      if (scrollParent) {
        scrollContainer = scrollParent as HTMLElement;
      }
    }

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    
    // Initial calculation once components mount
    handleScroll();

    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, [headings]);

  const scrollToHeading = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (el) {
      const scrollParent = el.closest(".overflow-y-auto");
      if (scrollParent) {
        // Relative vertical offset inside nested Scrollable container
        const parentRect = scrollParent.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const relativeTop = elRect.top - parentRect.top;
        
        (scrollParent as HTMLElement).scrollTo({
          top: (scrollParent as HTMLElement).scrollTop + relativeTop - 70, // offset for sticky header
          behavior: "smooth"
        });
      } else {
        // Standard window scroll
        window.scrollTo({
          top: window.scrollY + el.getBoundingClientRect().top - 100, // standard offset for header
          behavior: "smooth"
        });
      }
      // Also update URL hash
      try {
        window.history.pushState(null, '', `#${id}`);
      } catch (err) {
        console.warn("[DocsLayout] pushState is ignored due to security constraints in the current sandbox environment:", err);
      }
    }
  };

  const handleNavClick = () => {
    setMobileMenuOpen(false);
    window.scrollTo(0, 0);
  };

  const filteredNavConfig = navConfig.map(group => ({
    ...group,
    items: group.items.filter(item => 
      item.title.toLowerCase().includes(searchQuery.toLowerCase())
    )
  })).filter(group => group.items.length > 0);

  const SidebarContent = (
    <div className="flex flex-col h-full bg-surface-muted/50 md:bg-transparent">
      <div className="p-4 md:p-0 mb-4 sticky top-0 bg-surface-muted md:bg-surface z-10">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-content-muted" />
          <input
            type="text"
            placeholder={t("docs.docsLayout.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-surface md:bg-surface-muted border border-outline rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-content-muted transition-shadow"
          />
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto px-4 md:px-0 pb-20 md:pb-4 space-y-6">
        {filteredNavConfig.map((group, gIdx) => (
          <div key={gIdx} className="space-y-2">
            <h4 className="text-[11px] font-bold text-content-muted uppercase tracking-wider mb-2 px-1">
              {group.group}
            </h4>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <Link
                  key={item.id}
                  to={getItemUrl(item.id)}
                  onClick={handleNavClick}
                  className={cn(
                    "w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors",
                    activeId === item.id
                      ? "bg-blue-50 text-blue-700 font-semibold"
                      : "text-content-secondary hover:bg-control-hover hover:text-content"
                  )}
                >
                  <span className="leading-snug pr-2">{item.title}</span>
                  {item.isNew && (
                    <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-sm">New</span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-surface md:bg-[#fafafa]">
      
      {/* Mobile Drawer Trigger & Header */}
      <div className="md:hidden sticky top-[72px] z-30 bg-surface/90 backdrop-blur-md border-b border-outline px-4 py-3 flex items-center justify-between -mx-0">
        <div className="flex items-center gap-2 text-sm font-medium text-content-secondary truncate">
          <BookOpen className="w-4 h-4 text-blue-600" />
          <span className="truncate">{title}</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => setMobileMenuOpen(true)}>
          <Menu className="w-4 h-4 mr-1.5" />
          {t("docs.docsLayout.menuBtn")}
        </Button>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[9999] md:hidden bg-slate-900/50 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)}>
          <div 
            className="absolute top-0 right-0 w-[280px] h-full bg-surface shadow-2xl flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-outline">
              <span className="font-semibold text-content">{t("docs.docsLayout.docsMenu")}</span>
              <button onClick={() => setMobileMenuOpen(false)} className="p-1.5 rounded-md hover:bg-control-hover text-content-muted">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
               {SidebarContent}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Main Layout */}
      <div className="max-w-[1440px] mx-auto w-full md:px-6 lg:px-8">
        <div className="flex items-start">
          
          {/* Left Sidebar (Desktop) */}
          <aside className="hidden md:block w-[260px] lg:w-[280px] shrink-0 h-[calc(100vh-80px)] sticky top-20 pt-8 pb-12 pr-6 border-r border-outline/60">
            {SidebarContent}
          </aside>

          {/* Center Main Content */}
          <main className="flex-1 min-w-0 md:pt-8 md:pb-24 px-4 md:px-10 lg:px-16 w-full max-w-[900px] mx-auto bg-surface md:bg-transparent relative">
            {/* Breadcrumbs */}
            <nav className="hidden md:flex items-center gap-1.5 text-sm text-content-muted mb-6 font-medium">
              {breadcrumbs.map((bc, i) => (
                <React.Fragment key={i}>
                  <span className={i === breadcrumbs.length - 1 ? "text-content font-semibold" : "hover:text-content transition-colors cursor-pointer"}>
                    {bc}
                  </span>
                  {i < breadcrumbs.length - 1 && <ChevronRight className="w-3.5 h-3.5 text-content-muted" />}
                </React.Fragment>
              ))}
            </nav>

            {/* Article Header */}
            <header className="py-6 md:py-0 md:mb-10 space-y-4 border-b border-outline md:border-none">
              <h1 className="text-3xl md:text-4xl font-extrabold text-content tracking-tight leading-tight">
                {title}
              </h1>
              {description && (
                <p className="text-base md:text-lg text-content-secondary leading-relaxed max-w-3xl">
                  {description}
                </p>
              )}
              {meta && meta.length > 0 && (
                <div className="flex flex-wrap items-center gap-4 pt-2">
                  {meta.map((m, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="text-content-muted">{m.label}:</span>
                      <span className="font-medium text-content-secondary bg-control-hover px-2.5 py-0.5 rounded-md">{m.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </header>

            {/* Article Body */}
            <article 
              className="docs-content prose prose-slate md:prose-lg max-w-none pt-6 md:pt-0 pb-16"
              ref={contentRef}
            >
              <DocsErrorBoundary>
                {children}
              </DocsErrorBoundary>
            </article>

            {/* Back to top (Mobile) */}
            <div className="md:hidden flex justify-center py-8">
              <button 
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                className="text-sm font-medium text-content-muted hover:text-content bg-control-hover px-4 py-2 rounded-full transition-colors flex items-center gap-2"
              >
                {t("docs.docsLayout.backToTop")}
              </button>
            </div>

            {/* Footer Nav (Optional enhancement later) */}
          </main>

          {/* Right TOC (Desktop/Tablet) */}
          <aside className="hidden xl:block w-[240px] shrink-0 h-[calc(100vh-80px)] sticky top-20 pt-10 pb-12 pl-6 border-l border-outline/60">
            {headings.length > 0 ? (
              <div className="space-y-4">
                <h4 className="text-[11px] font-bold text-content-muted uppercase tracking-wider mb-2">{t("docs.docsLayout.onThisPage")}</h4>
                <nav className="space-y-1 text-sm border-l border-outline">
                  {headings.map((heading) => (
                    <a
                      key={heading.id}
                      href={`#${heading.id}`}
                      onClick={(e) => scrollToHeading(heading.id, e)}
                      className={cn(
                        "block py-1.5 transition-colors border-l text-[13px] leading-snug",
                        heading.level === 3 ? "pl-6" : "pl-4",
                        activeHeadingId === heading.id
                          ? "border-blue-600 text-blue-600 font-medium bg-blue-50/50"
                          : "border-transparent text-content-muted hover:text-content hover:border-outline-strong"
                      )}
                    >
                      {heading.text}
                    </a>
                  ))}
                </nav>
              </div>
            ) : (
              <div className="text-sm text-content-muted pt-2">{t("docs.docsLayout.noHeadings")}</div>
            )}
          </aside>
          
        </div>
      </div>
    </div>
  );
}
