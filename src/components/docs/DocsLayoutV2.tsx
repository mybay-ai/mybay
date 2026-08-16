import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { DocsHeader } from "./DocsHeader";
import { DocsSearchDialog } from "./DocsSearchDialog";
import type { DocsHeading, DocsLocale, DocsNavigationEntry, DocsNavigationGroup } from "../../lib/docs/docsTypes";
import { resolveDocsId } from "../../lib/docs/docsAliases";
import "./docs-shell-v2.css";

interface DocsLayoutV2Props {
  variant: "public" | "embedded";
  navigation: DocsNavigationGroup[];
  activeId: string;
  locale: DocsLocale;
  breadcrumbs: string[];
  title: string;
  description?: string;
  meta?: { label: string; value: string }[];
  headings?: DocsHeading[];
  previous?: DocsNavigationEntry;
  next?: DocsNavigationEntry;
  children: React.ReactNode;
}

export function DocsLayoutV2({ variant, navigation, activeId, locale, breadcrumbs, title, description, meta, headings = [], previous, next, children }: DocsLayoutV2Props) {
  const { t } = useTranslation("docs");
  const embedded = variant === "embedded";
  const canonicalActiveId = resolveDocsId(activeId);
  const activeGroupId = navigation.find(group => group.items.some(item => item.id === canonicalActiveId || item.legacyIds?.includes(activeId)))?.id;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeHeading, setActiveHeading] = useState(headings[0]?.id || "");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try { return new Set(JSON.parse(localStorage.getItem("mybay-docs-collapsed-groups") || "[]")); } catch { return new Set(); }
  });

  useEffect(() => {
    if (!activeGroupId) return;
    setCollapsed(current => {
      if (!current.has(activeGroupId)) return current;
      const next = new Set(current); next.delete(activeGroupId); return next;
    });
  }, [activeGroupId]);

  useEffect(() => {
    const open = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener("keydown", open);
    return () => window.removeEventListener("keydown", open);
  }, []);

  useEffect(() => {
    const update = () => {
      let current = headings[0]?.id || "";
      for (const heading of headings) {
        const element = document.getElementById(heading.id);
        if (element && element.getBoundingClientRect().top <= 135) current = heading.id;
        else if (element) break;
      }
      setActiveHeading(current);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [headings]);

  const toggleGroup = (id: string) => setCollapsed(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    if (typeof window !== "undefined") localStorage.setItem("mybay-docs-collapsed-groups", JSON.stringify([...next]));
    return next;
  });

  const itemHref = (item: DocsNavigationEntry) => embedded ? `/app/guides?guide=${encodeURIComponent(item.legacyIds?.[0] || item.id)}` : item.href;
  const sidebar = useMemo(() => (
    <nav className="docs-v2-sidebar-nav" aria-label={t("navigation")}>
      {navigation.map(group => {
        const isCollapsed = collapsed.has(group.id);
        return <section key={group.id}>
          <button type="button" onClick={() => toggleGroup(group.id)} aria-expanded={!isCollapsed}><span>{group.title}</span><ChevronDown className={isCollapsed ? "is-collapsed" : ""} /></button>
          {!isCollapsed && <div>{group.items.map(item => {
            const active = item.id === canonicalActiveId || item.legacyIds?.includes(activeId);
            return <Link key={item.id} to={itemHref(item)} aria-current={active ? "page" : undefined} className={active ? "is-active" : ""} onClick={() => setMobileOpen(false)}>{item.title}</Link>;
          })}</div>}
        </section>;
      })}
    </nav>
  ), [navigation, collapsed, canonicalActiveId, activeId, embedded, t]);

  return (
    <div className="docs-v2-shell">
      {!embedded && <DocsHeader onMenu={() => setMobileOpen(true)} onSearch={() => setSearchOpen(true)} />}
      <DocsSearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} locale={locale} />
      {mobileOpen && <div className="docs-v2-mobile-overlay" onMouseDown={event => event.target === event.currentTarget && setMobileOpen(false)}><aside><div><strong>{t("brand")}</strong><button type="button" onClick={() => setMobileOpen(false)} aria-label={t("closeMenu")}><X aria-hidden="true" /></button></div>{sidebar}</aside></div>}
      <div className={`docs-v2-grid ${embedded ? "is-app-mode" : ""}`}>
        <aside className="docs-v2-sidebar">{sidebar}</aside>
        <main className="docs-v2-main">
          <nav className="docs-v2-breadcrumb" aria-label={t("breadcrumb")}>{breadcrumbs.map((value, index) => <React.Fragment key={`${value}-${index}`}><span>{value}</span>{index < breadcrumbs.length - 1 && <ChevronRight aria-hidden="true" />}</React.Fragment>)}</nav>
          <header className="docs-v2-article-header"><h1>{title}</h1>{description && <p>{description}</p>}{meta && meta.length > 0 && <div>{meta.map(item => <span key={item.label}><small>{item.label}</small>{item.value}</span>)}</div>}</header>
          <article className="docs-v2-article">{children}</article>
          {(previous || next) && <nav className="docs-v2-pagination" aria-label={t("pagination")}>
            {previous ? <Link to={embedded ? `/app/guides?guide=${encodeURIComponent(previous.legacyIds?.[0] || previous.id)}` : previous.href} className="is-previous"><small><ChevronLeft aria-hidden="true" />{t("previous")}</small><strong>{previous.title}</strong></Link> : <span />}
            {next ? <Link to={embedded ? `/app/guides?guide=${encodeURIComponent(next.legacyIds?.[0] || next.id)}` : next.href} className="is-next"><small>{t("next")}<ChevronRight aria-hidden="true" /></small><strong>{next.title}</strong></Link> : <span />}
          </nav>}
        </main>
        <aside className="docs-v2-toc"><strong>{t("onThisPage")}</strong><nav>{headings.map(heading => <a key={heading.id} href={`#${heading.id}`} className={`${heading.level === 3 ? "is-h3" : ""} ${activeHeading === heading.id ? "is-active" : ""}`}>{heading.text}</a>)}</nav></aside>
      </div>
    </div>
  );
}
