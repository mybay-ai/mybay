import { Helmet } from "react-helmet-async";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SEO_CONFIG, SITE_CONFIG, SEOMeta } from "../config/seo";

export function resolveSeoConfig(pathname: string, search: string, t: any): SEOMeta | null {
  // 1. Check if it's a dynamic instance setup route: /app/instances/:id/setup
  const setupRegex = /^\/app\/instances\/[^/]+\/setup$/;
  if (setupRegex.test(pathname)) {
    return {
      title: t("page_titles.instance_setup"),
      description: "配置您的 AI 智能体实例业务属性与通知渠道。",
      noindex: true,
    };
  }

  // 2. Check if it's the main app route
  if (pathname === "/app") {
    const params = new URLSearchParams(search);
    const tab = params.get("tab") || "overview";
    const titleKey = tab.replace("-", "_");
    const title = t(`page_titles.${titleKey}`);
    return {
      title: title || t("page_titles.overview"),
      description: "管理您的 AI Agent 实例、监控运行状态和日志。",
      noindex: true,
    };
  }

  // 3. Check other app subroutes
  if (pathname === "/app/instances") {
    return {
      title: t("page_titles.instances"),
      description: "查看和管理您所有的 AI Agent 部署实例。",
      noindex: true,
    };
  }
  if (pathname === "/app/deploy") {
    return {
      title: t("page_titles.deploy"),
      description: "快速配置并部署一个新的 Hermes AI Agent 实例。",
      noindex: true,
    };
  }
  if (pathname === "/app/templates") {
    return {
      title: t("page_titles.templates"),
      description: "选择最适合您业务场景的 AI 智能体模板开始运行。",
      noindex: true,
    };
  }
  if (pathname === "/app/credentials") {
    return {
      title: t("page_titles.credentials"),
      description: "安全管理您的 API Key 和平台对接凭证。",
      noindex: true,
    };
  }
  if (pathname === "/app/chat") {
    return {
      title: t("page_titles.chat_workspace"),
      description: "与 AI Agent 对话并查看任务运行过程和结果。",
      noindex: true,
    };
  }
  if (pathname === "/app/guides") {
    return {
      title: t("page_titles.guides"),
      description: "获取针对不同平台的 Agent 部署与对接指南。",
      noindex: true,
    };
  }

  if (pathname === "/faq") {
    return {
      title: t("page_titles.faq"),
      description: t("page_descriptions.faq"),
    };
  }

  // 4. Fallback to static SEO config
  const staticConfig = SEO_CONFIG[pathname];
  if (staticConfig) {
    return staticConfig;
  }

  if (pathname.startsWith("/app")) {
    return {
      title: t("page_titles.overview"),
      description: "管理您的 AI Agent 实例、监控运行状态和日志。",
      noindex: true,
    };
  }

  return null;
}

interface SEOHeadProps {
  title?: string;
  description?: string;
  canonical?: string;
  noindex?: boolean;
  jsonLd?: any;
  keywords?: string[];
  ogType?: string;
}

export function SEOHead({ title, description, canonical, noindex, jsonLd, keywords, ogType }: SEOHeadProps) {
  const location = useLocation();
  const path = location.pathname;
  const { t } = useTranslation("dashboard");
  
  // Get config for current route
  const resolvedConfig = resolveSeoConfig(path, location.search, t);
  
  const finalTitle = title || resolvedConfig?.title || SITE_CONFIG.name;
  const finalDescription = description || resolvedConfig?.description || SITE_CONFIG.defaultDescription;
  const finalNoIndex = noindex !== undefined ? noindex : resolvedConfig?.noindex;
  const currentUrl = `${SITE_CONFIG.url}${path}`;
  const finalCanonical = canonical || currentUrl;

  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": SITE_CONFIG.name,
    "url": SITE_CONFIG.url,
    "logo": `${SITE_CONFIG.url}/favicon.svg`
  };

  const softwareAppJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": SITE_CONFIG.name,
    "operatingSystem": "Web",
    "applicationCategory": "BusinessApplication",
    "offers": {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "USD"
    }
  };

  return (
    <Helmet>
      <title>{finalTitle}</title>
      <meta name="description" content={finalDescription} />
      {keywords && keywords.length > 0 && (
        <meta name="keywords" content={keywords.join(", ")} />
      )}
      
      {/* Canonical URL */}
      {!finalNoIndex && <link rel="canonical" href={finalCanonical} />}
      
      {/* Robots */}
      {finalNoIndex && <meta name="robots" content="noindex,nofollow" />}
      
      {/* Open Graph */}
      <meta property="og:title" content={finalTitle} />
      <meta property="og:description" content={finalDescription} />
      <meta property="og:url" content={finalCanonical} />
      <meta property="og:type" content={ogType || "website"} />
      <meta property="og:image" content={`${SITE_CONFIG.url}/og-image.png`} />
      
      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={finalTitle} />
      <meta name="twitter:description" content={finalDescription} />
      <meta name="twitter:image" content={`${SITE_CONFIG.url}/og-image.png`} />
      
      {/* JSON-LD */}
      {path === "/" && (
        <script type="application/ld+json">
          {JSON.stringify([organizationJsonLd, softwareAppJsonLd])}
        </script>
      )}
      {jsonLd && (
        <script type="application/ld+json">
          {JSON.stringify(jsonLd)}
        </script>
      )}
    </Helmet>
  );
}
