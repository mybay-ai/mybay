import React, { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, Info, Lightbulb, AlertTriangle, OctagonAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DocsDocument } from "../../lib/docs/docsTypes";
import "./docs-v2.css";

const CALLOUT = /^\[!(NOTE|TIP|INFO|WARNING|DANGER)\]\s*/i;

function textFromNode(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join("");
  if (React.isValidElement(node)) return textFromNode((node.props as { children?: React.ReactNode }).children);
  return "";
}

function DocsCalloutBlock({ children }: { children?: React.ReactNode }) {
  const { t } = useTranslation("docs");
  const raw = textFromNode(children).trim();
  const match = raw.match(CALLOUT);
  if (!match) return <blockquote className="docs-blockquote">{children}</blockquote>;
  const type = match[1].toUpperCase();
  const text = raw.replace(CALLOUT, "").trim();
  const config = {
    NOTE: { icon: Info, label: t("calloutNote"), className: "docs-callout-note" },
    INFO: { icon: Info, label: t("calloutInfo"), className: "docs-callout-info" },
    TIP: { icon: Lightbulb, label: t("calloutTip"), className: "docs-callout-tip" },
    WARNING: { icon: AlertTriangle, label: t("calloutWarning"), className: "docs-callout-warning" },
    DANGER: { icon: OctagonAlert, label: t("calloutDanger"), className: "docs-callout-danger" },
  }[type] || { icon: Info, label: type, className: "docs-callout-note" };
  const Icon = config.icon;
  return <aside className={`docs-callout ${config.className}`} role="note"><div className="docs-callout-title"><Icon aria-hidden="true" />{config.label}</div><div className="docs-callout-body">{text}</div></aside>;
}

const KEYWORDS = new Set(["const", "let", "var", "function", "return", "if", "else", "for", "while", "import", "export", "from", "async", "await", "type", "interface", "true", "false", "null", "undefined"]);

function highlightCodeLine(line: string, language: string): React.ReactNode[] {
  if (!/^(js|jsx|ts|tsx|json|bash|sh|shell|powershell|yaml|yml)$/i.test(language)) return [line];
  const parts = line.split(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b|#.*$|\/\/.*$)/g);
  return parts.filter(Boolean).map((part, index) => {
    let className = "";
    if (/^(#|\/\/)/.test(part)) className = "docs-token-comment";
    else if (/^["'`]/.test(part)) className = "docs-token-string";
    else if (/^\d/.test(part)) className = "docs-token-number";
    else if (KEYWORDS.has(part)) className = "docs-token-keyword";
    return className ? <span className={className} key={index}>{part}</span> : <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

function DocsFence({ code, language }: { code: string; language: string }) {
  const { t } = useTranslation("docs");
  const [copied, setCopied] = useState(false);
  const lines = code.split("\n");
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return <div className="docs-code-block"><div className="docs-code-toolbar"><span>{language || "text"}</span><button type="button" onClick={copy} aria-label={t("copyCode")}>{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copied ? t("copied") : t("copy")}</button></div><pre><code>{lines.map((line, index) => <React.Fragment key={index}>{highlightCodeLine(line, language)}{index < lines.length - 1 ? "\n" : ""}</React.Fragment>)}</code></pre></div>;
}

export function MarkdownDocumentRenderer({ document }: { document: DocsDocument }) {
  const { t } = useTranslation("docs");
  const headingComponents = useMemo(() => {
    let headingIndex = 0;
    const heading = (level: 2 | 3) => ({ children }: { children?: React.ReactNode }) => {
      const expected = document.headings[headingIndex++];
      const id = expected?.id;
      const Tag = `h${level}` as "h2" | "h3";
      const text = textFromNode(children);
      return <Tag id={id} className="docs-heading"><a href={`#${id}`} aria-label={t("linkToHeading", { heading: text })}>{children}</a></Tag>;
    };
    return { h2: heading(2), h3: heading(3) };
  }, [document.id, document.markdown, document.headings, t]);

  return <div className="docs-markdown-content">
    {document.isFallback && <div className="docs-language-fallback" role="status">{t("fallbackChinese")}</div>}
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
      ...headingComponents,
      blockquote: DocsCalloutBlock,
      pre: ({ children }) => <>{children}</>,
      code: ({ className, children }) => {
        const language = /language-([^\s]+)/.exec(className || "")?.[1];
        const code = String(children).replace(/\n$/, "");
        return language ? <DocsFence code={code} language={language} /> : <code className="docs-inline-code">{children}</code>;
      },
      table: ({ children }) => <div className="docs-table-wrap"><table>{children}</table></div>,
      img: ({ src, alt }) => <figure className="docs-figure"><img src={src || ""} alt={alt || ""} loading="lazy" />{alt && <figcaption>{alt}</figcaption>}</figure>,
      a: ({ href, children }) => {
        const external = Boolean(href && /^(https?:)?\/\//.test(href));
        return <a href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>{children}</a>;
      },
    }}>{document.markdown}</ReactMarkdown>
  </div>;
}
