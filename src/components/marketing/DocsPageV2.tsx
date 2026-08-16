import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { DocsPage as LegacyDocsPage } from "./DocsPage";
import { GuideDocV2 } from "../GuideDocV2";
import { SEOHead } from "../SEOHead";
import { SITE_CONFIG } from "../../config/seo";
import { documentHref } from "../../lib/docs/docsSlug";
import { resolveDocsId } from "../../lib/docs/docsAliases";
import { getMarkdownDocumentSync, hasMarkdownDocument, loadMarkdownDocument } from "../../lib/docs/docsLoader";
import type { DocsDocument, DocsLocale } from "../../lib/docs/docsTypes";

export function DocsPageV2({ currentUser }: { currentUser: unknown }) {
  const { i18n } = useTranslation("docs");
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const locale: DocsLocale = i18n.language === "zh-CN" ? "zh-CN" : "en";
  const pathId = location.pathname.startsWith("/docs/") ? decodeURIComponent(location.pathname.slice(6)).replace(/\/$/, "") : "";
  const queryId = searchParams.get("guide") || "";
  const requestedId = pathId || queryId;
  const resolvedId = requestedId ? resolveDocsId(requestedId) : "docs_home";
  const isHome = resolvedId === "docs_home";
  const markdownExists = !isHome && (hasMarkdownDocument(locale, resolvedId) || hasMarkdownDocument("zh-CN", resolvedId));

  if (!isHome && !markdownExists) return <LegacyDocsPage currentUser={currentUser as any} />;
  return <MarkdownDocsPage activeId={resolvedId} queryId={queryId} locale={locale} />;
}

function MarkdownDocsPage({ activeId, queryId, locale }: { activeId: string; queryId: string; locale: DocsLocale }) {
  const { t } = useTranslation("docs");
  const navigate = useNavigate();
  const [document, setDocument] = useState<DocsDocument | null>(() => activeId === "docs_home" ? null : getMarkdownDocumentSync(locale, activeId));

  useEffect(() => {
    let cancelled = false;
    if (activeId === "docs_home") { setDocument(null); return; }
    loadMarkdownDocument(locale, activeId).then(value => { if (!cancelled) setDocument(value); });
    return () => { cancelled = true; };
  }, [activeId, locale]);

  useEffect(() => {
    if (!queryId) return;
    const resolved = resolveDocsId(queryId);
    navigate(resolved === "docs_home" ? "/docs" : documentHref(resolved), { replace: true });
  }, [queryId, navigate]);

  const canonical = activeId === "docs_home" ? `${SITE_CONFIG.url}/docs` : `${SITE_CONFIG.url}${documentHref(activeId)}`;
  const title = document ? `${document.title} - ${t("seo.siteTitle")}` : t("seo.siteTitle");
  const description = document?.description || t("seo.description");
  const jsonLd = useMemo(() => document ? [
    { "@context": "https://schema.org", "@type": "Article", headline: document.title, description: document.description, dateModified: document.updatedAt, url: canonical, inLanguage: document.locale, author: { "@type": "Organization", name: "MyBay", url: SITE_CONFIG.url } },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "MyBay", item: SITE_CONFIG.url },
      { "@type": "ListItem", position: 2, name: t("brand"), item: `${SITE_CONFIG.url}/docs` },
      { "@type": "ListItem", position: 3, name: document.title, item: canonical },
    ] },
  ] : undefined, [document, canonical, t]);
  const navigateToDocument = (id: string) => navigate(id === "docs_home" ? "/docs" : documentHref(resolveDocsId(id)));

  return <><SEOHead title={title} description={description} canonical={canonical} keywords={document?.keywords} jsonLd={jsonLd} ogType={document ? "article" : "website"} /><GuideDocV2 activeGuideId={activeId} setActiveGuideId={navigateToDocument} variant="public" /></>;
}
