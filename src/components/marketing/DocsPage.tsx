import React, { Component, ErrorInfo, ReactNode, useState, useEffect } from "react";
import { Link, useSearchParams, useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { GuideDoc } from "../Docs";
import { VALID_GUIDES, getStructuredDocById, structuredDocsRegistry } from "../../data/docs/docs.registry";
import { SEOHead } from "../SEOHead";
import { SITE_CONFIG } from "../../config/seo";

// Safely wrapped localStorage helper inside docs context
function getSafeCachedDocTab(): string {
  if (typeof window === "undefined") return "platform";
  try {
    return window.localStorage.getItem("mybay_docs_active_tab") || "platform";
  } catch {
    return "platform";
  }
}

function setSafeCachedDocTab(tab: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem("mybay_docs_active_tab", tab);
  } catch {
    // safe ignore in partition/sandbox environments
  }
}

// 1. ErrorBoundary to catch and recover from sandboxed environment render exceptions gracefully
interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class DocsErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[DocsErrorBoundary] caught unhandled docs crash:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      let isZh = true;
      if (typeof window !== "undefined") {
        try {
          if (window.localStorage.getItem("mybay_language") === "en") {
            isZh = false;
          }
        } catch (e) {
          // ignore catch for sandboxes
        }
      }

      return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
          <div className="max-w-md bg-white p-8 rounded-2xl shadow-xl border border-slate-200 text-left">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-100">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2 text-center">
              {isZh ? "文档加载异常" : "Document Loading Interrupted"}
            </h2>
            <p className="text-slate-600 mb-6 text-sm leading-relaxed text-center">
              {isZh 
                ? "由于沙箱环境内的安全限制或组件渲染发生冲突，文档视图暂无法直接加载。请尝试点击下方“刷新”以清空缓存，或者返回首页。" 
                : "Due to sandbox security restrictions or component conflicts, the document viewport failed to render. Try refreshing or going back home."}
            </p>
            <div className="flex gap-4 justify-center">
              <button 
                onClick={() => {
                  try {
                    window.localStorage.removeItem("mybay_docs_active_tab");
                  } catch {}
                  window.location.reload();
                }} 
                className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition"
              >
                {isZh ? "刷新页面" : "Refresh Page"}
              </button>
              <Link 
                to="/" 
                className="px-5 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 transition"
              >
                {isZh ? "返回首页" : "Back to Home"}
              </Link>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function DocsPage({ currentUser }: { currentUser: any }) {
  const { t, i18n } = useTranslation("marketing");
  const isZh = i18n.language === "zh-CN";
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [fallbackActiveId, setFallbackActiveId] = useState<string>(() => getSafeCachedDocTab());

  const pathname = location.pathname;
  const urlGuide = searchParams.get("guide");
  const pathSlug = pathname.startsWith("/docs/") ? decodeURIComponent(pathname.slice("/docs/".length)) : "";

  const getDocPath = (id: string) => {
    if (id === "platform") return "/docs";
    const doc = getStructuredDocById(id);
    if (doc?.slug) return `/docs/${doc.slug}`;
    return `/docs?guide=${id}`;
  };

  // Determine actual activeId based on slug route, query param, or cached state.
  let activeId = "platform";
  let isDocNotFound = false;
  if (pathSlug) {
    const docFromSlug = structuredDocsRegistry.find((doc) => doc.slug === pathSlug);
    if (docFromSlug) {
      activeId = docFromSlug.id;
    } else {
      activeId = "doc_not_found";
      isDocNotFound = true;
    }
  } else if (urlGuide) {
    if (VALID_GUIDES.includes(urlGuide)) {
      activeId = urlGuide;
    } else {
      activeId = "doc_not_found";
      isDocNotFound = true;
    }
  } else {
    const cached = fallbackActiveId;
    if (cached && VALID_GUIDES.includes(cached)) {
      activeId = cached;
    }
  }

  // Handle URL normalization side-effects cleanly.
  useEffect(() => {
    if (isDocNotFound) {
      return;
    }

    const targetPath = getDocPath(activeId);
    const currentPath = `${pathname}${location.search}`;
    if (currentPath !== targetPath) {
      try {
        navigate(targetPath, { replace: true });
      } catch (e) {
        console.warn("Navigation failed in sandboxed iframe fallback", e);
      }
    }
    setSafeCachedDocTab(activeId);
  }, [activeId, pathname, location.search, navigate, isDocNotFound]);

  const handleSetView = (id: string) => {
    setFallbackActiveId(id);
    setSafeCachedDocTab(id);
    navigate(getDocPath(id));
  };

  // Generate Dynamic SEO metadata and JSON-LD structured data for Pilot Articles
  const structuredDoc = getStructuredDocById(activeId);
  let seoTitle = undefined;
  let seoDescription = undefined;
  let seoCanonical = undefined;
  let seoJsonLd = undefined;
  let seoKeywords = undefined;
  let noindex = undefined;

  if (isDocNotFound) {
    seoTitle = isZh ? "文档未找到 - 使用指南 - 麦贝 MyBayAI" : "Document Not Found - Docs - MyBay";
    seoDescription = isZh ? "您请求的文档指南未找到。请通过导航栏浏览现有的技术指南。" : "The requested document guide could not be found. Please use the navigation to browse our guides.";
    noindex = true;
  } else if (structuredDoc) {
    const docTitle = isZh ? structuredDoc.content["zh-CN"].title : structuredDoc.content.en.title;
    const docSummary = isZh ? structuredDoc.content["zh-CN"].summary : structuredDoc.content.en.summary;
    seoTitle = isZh ? `${docTitle} - 使用文档 - 麦贝 MyBayAI` : `${docTitle} - Docs - MyBay`;
    seoDescription = docSummary;
    
    const articlePath = `/docs/${structuredDoc.slug}`;
    const canonicalUrl = `${SITE_CONFIG.url}${articlePath}`;
    seoCanonical = canonicalUrl;
    
    seoKeywords = isZh ? structuredDoc.keywords?.["zh-CN"] : structuredDoc.keywords?.en;

    const versionStr = isZh 
      ? structuredDoc.applicableVersion 
      : (structuredDoc.applicableVersionEn || structuredDoc.applicableVersion);

    seoJsonLd = [
      {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": docTitle,
        "description": seoDescription,
        "dateModified": structuredDoc.updatedAt,
        ...(structuredDoc.publishedAt
          ? { "datePublished": structuredDoc.publishedAt }
          : {}),
        "version": versionStr,
        "url": canonicalUrl,
        "mainEntityOfPage": {
          "@type": "WebPage",
          "@id": canonicalUrl
        },
        "inLanguage": isZh ? "zh-CN" : "en",
        "author": {
          "@type": "Organization",
          "name": "麦贝 MyBayAI",
          "url": SITE_CONFIG.url
        }
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
          {
            "@type": "ListItem",
            "position": 1,
            "name": isZh ? "首页" : "Home",
            "item": SITE_CONFIG.url
          },
          {
            "@type": "ListItem",
            "position": 2,
            "name": isZh ? "使用文档" : "Docs",
            "item": `${SITE_CONFIG.url}/docs`
          },
          {
            "@type": "ListItem",
            "position": 3,
            "name": isZh 
              ? (structuredDoc.breadcrumbLabel?.["zh-CN"] || "文档正文") 
              : (structuredDoc.breadcrumbLabel?.en || "Article"),
            "item": canonicalUrl
          }
        ]
      }
    ];
  }

  return (
    <DocsErrorBoundary>
      <SEOHead 
        title={seoTitle}
        description={seoDescription}
        canonical={seoCanonical}
        jsonLd={seoJsonLd}
        keywords={seoKeywords}
        ogType={structuredDoc ? "article" : "website"}
        noindex={noindex}
      />
      <div className="relative flex-1 bg-white pt-24 md:pt-32 pb-6">
        <div className="max-w-[1440px] mx-auto">
          <GuideDoc activeGuideId={activeId} setActiveGuideId={handleSetView} />
        </div>
      </div>
    </DocsErrorBoundary>
  );
}
