import { useEffect, useState } from "react";
import { AlertTriangle, KeyRound, Server, Workflow } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { GuideDoc as LegacyGuideDoc } from "./Docs";
import { DocsLayoutV2 } from "./docs/DocsLayoutV2";
import { MarkdownDocumentRenderer } from "./docs/MarkdownDocumentRenderer";
import { getDocsBreadcrumbs, getDocsNavigation, getDocsPagination, getDocsRootTitle } from "../lib/docs/docsNavigation";
import { getMarkdownDocumentSync, hasMarkdownDocument, loadMarkdownDocument } from "../lib/docs/docsLoader";
import { documentHref } from "../lib/docs/docsSlug";
import { resolveDocsId } from "../lib/docs/docsAliases";
import type { DocsDocument, DocsLocale } from "../lib/docs/docsTypes";
import "./docs/docs-home-v2.css";

interface GuideDocV2Props {
  activeGuideId?: string;
  setActiveGuideId?: (id: string) => void;
  variant?: "public" | "embedded";
}

export function GuideDocV2({ activeGuideId = "docs_home", setActiveGuideId, variant = "embedded" }: GuideDocV2Props) {
  const { i18n } = useTranslation("docs");
  const locale: DocsLocale = i18n.language === "zh-CN" ? "zh-CN" : "en";
  const canonicalId = resolveDocsId(activeGuideId);
  const isHome = canonicalId === "docs_home";
  const markdownExists = !isHome && (hasMarkdownDocument(locale, canonicalId) || hasMarkdownDocument("zh-CN", canonicalId));

  if (!isHome && !markdownExists) {
    return <LegacyGuideDoc activeGuideId={activeGuideId} setActiveGuideId={setActiveGuideId} />;
  }

  return <MarkdownGuideDoc activeGuideId={activeGuideId} canonicalId={canonicalId} setActiveGuideId={setActiveGuideId} variant={variant} locale={locale} />;
}

function MarkdownGuideDoc({ activeGuideId, canonicalId, setActiveGuideId, variant, locale }: Required<Pick<GuideDocV2Props, "activeGuideId" | "variant">> & Pick<GuideDocV2Props, "setActiveGuideId"> & { canonicalId: string; locale: DocsLocale }) {
  const { t } = useTranslation("docs");
  const navigate = useNavigate();
  const isHome = canonicalId === "docs_home";
  const [document, setDocument] = useState<DocsDocument | null>(() => isHome ? null : getMarkdownDocumentSync(locale, canonicalId));
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    if (isHome) { setDocument(null); setLoading(false); return; }
    setLoading(true);
    loadMarkdownDocument(locale, canonicalId)
      .then(value => { if (!cancelled) { setDocument(value); setLoadError(!value); } })
      .catch(error => { console.error("[GuideDocV2] Failed to load document", error); if (!cancelled) { setDocument(null); setLoadError(true); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [canonicalId, locale, isHome]);

  const go = (id: string) => {
    if (setActiveGuideId) setActiveGuideId(id);
    else navigate(id === "docs_home" ? "/docs" : documentHref(resolveDocsId(id)));
  };
  const navigation = getDocsNavigation(locale);
  const pagination = document
    ? getDocsPagination(locale, document.id)
    : { previous: undefined, next: undefined };
  const title = isHome ? t("homeTitle") : loadError ? t("notFoundTitle") : document?.title || t("loadingTitle");
  const description = isHome ? t("homeDescription") : document?.description || (loadError ? t("notFoundDescription") : undefined);
  const homeCards = [
    { id: "getting-started", title: t("cards.gettingStartedTitle"), description: t("cards.gettingStartedDescription"), icon: Workflow },
    { id: "installation/local-deployment", title: t("cards.localDeploymentTitle"), description: t("cards.localDeploymentDescription"), icon: Server },
    { id: "models/byok-credentials", title: t("cards.byokTitle"), description: t("cards.byokDescription"), icon: KeyRound },
  ];

  return <DocsLayoutV2 variant={variant} navigation={navigation} activeId={document?.id || canonicalId} locale={locale} breadcrumbs={isHome ? [getDocsRootTitle(locale)] : getDocsBreadcrumbs(locale, document?.id || canonicalId)} title={title} description={description} meta={document?.updatedAt ? [{ label: t("updated"), value: document.updatedAt }] : []} headings={document?.headings || []} previous={pagination.previous} next={pagination.next}>
    {loading ? <div className="docs-v2-loading">{t("loading")}</div>
      : isHome ? <div className="docs-v2-home-grid">{homeCards.map(card => { const Icon = card.icon; return <button key={card.id} type="button" onClick={() => go(card.id)}><Icon aria-hidden="true" /><span><strong>{card.title}</strong><small>{card.description}</small></span></button>; })}</div>
      : document ? <MarkdownDocumentRenderer document={document} />
      : <div className="docs-v2-not-found"><AlertTriangle aria-hidden="true" /><h2>{title}</h2><p>{description}</p><button type="button" onClick={() => go("docs_home")}>{t("backToDocs")}</button></div>}
  </DocsLayoutV2>;
}
