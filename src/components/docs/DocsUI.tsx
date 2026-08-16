import React, { useState } from "react";
import { AlertTriangle, Info, CheckCircle2, XCircle, Copy, Check, Terminal, ChevronRight, ExternalLink as ExternalLinkIcon } from "lucide-react";
import { cn, Button } from "../ui";
import { Link } from "react-router-dom";

// External Link Component
export function DocsExternalLink({
  href,
  children,
  className
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "text-blue-600 hover:text-blue-700 underline underline-offset-4 decoration-blue-200 hover:decoration-blue-500 font-medium transition-all inline-flex items-center gap-1 group",
        className
      )}
    >
      {children}
      <ExternalLinkIcon className="size-3.5 opacity-40 group-hover:opacity-100 transition-opacity" />
    </a>
  );
}

// Internal Link Component
export function DocsInternalLink({
  to,
  children,
  className
}: {
  to: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "text-blue-600 hover:text-blue-700 font-medium hover:underline underline-offset-4 decoration-blue-200 hover:decoration-blue-500 transition-all",
        className
      )}
    >
      {children}
    </Link>
  );
}

// Simple Error Boundary for Docs
export class DocsErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("[DocsErrorBoundary] Caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 my-8 rounded-2xl border-2 border-dashed border-red-200 bg-red-50 text-center">
          <AlertTriangle className="size-10 text-red-400 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-red-900 mb-2">文档渲染出错</h3>
          <p className="text-red-700 text-sm mb-4">很抱歉，该部分指南目前无法正常显示。我们的运维团队已收到错误报告。</p>
          <Button 
            variant="outline" 
            size="sm" 
            className="border-red-200 text-red-700 hover:bg-red-100"
            onClick={() => this.setState({ hasError: false })}
          >
            尝试重新加载
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Callout
export function DocsCallout({ 
  type = "info", 
  title, 
  children 
}: { 
  type?: "info" | "warning" | "success" | "error"; 
  title?: string; 
  children: React.ReactNode 
}) {
  const styles = {
    info: "bg-blue-50/50 border-blue-200 text-blue-800",
    warning: "bg-amber-50/50 border-amber-200 text-amber-800",
    success: "bg-emerald-50/50 border-emerald-200 text-emerald-800",
    error: "bg-red-50/50 border-red-200 text-red-800",
  };
  const icons = {
    info: <Info className="w-5 h-5 text-blue-500" />,
    warning: <AlertTriangle className="w-5 h-5 text-amber-500" />,
    success: <CheckCircle2 className="w-5 h-5 text-emerald-500" />,
    error: <XCircle className="w-5 h-5 text-red-500" />,
  };

  return (
    <div className={cn("my-6 p-4 rounded-xl border flex gap-3 text-sm leading-relaxed shadow-sm", styles[type])}>
      <div className="shrink-0 mt-0.5">{icons[type]}</div>
      <div className="flex-1 space-y-1">
        {title && <h5 className="font-bold text-base mb-1">{title}</h5>}
        <div className="opacity-95">{children}</div>
      </div>
    </div>
  );
}

// Checklist Component
export function DocsChecklist({ items }: { items: string[] }) {
  return (
    <div className="my-6">
      <h3 className="text-sm font-bold text-content-muted uppercase tracking-wider mb-3">准备事项 Checklist</h3>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
        {items.map((p, i) => (
          <li key={i} className="flex gap-2.5 text-sm text-content-secondary items-start group">
            <div className="size-5 rounded border border-outline bg-surface flex items-center justify-center shrink-0 mt-0.5 group-hover:border-blue-300 transition-colors shadow-sm">
              <Check className="size-3 text-slate-300 group-hover:text-blue-500" />
            </div>
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Official Links Section
export function DocsOfficialLinks({ 
  links 
}: { 
  links: { title: string; href: string }[] 
}) {
  return (
    <div className="mt-12 pt-8 border-t border-outline">
      <h3 className="text-sm font-bold text-content-muted uppercase tracking-wider mb-4">官方参考链接</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {links.map((link, i) => (
          <a
            key={i}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-3.5 rounded-xl border border-outline bg-surface-muted/50 hover:bg-surface hover:border-blue-200 hover:shadow-sm transition-all group"
          >
            <span className="text-sm font-medium text-content-secondary group-hover:text-blue-600 truncate">{link.title}</span>
            <ExternalLinkIcon className="size-4 text-slate-300 group-hover:text-blue-400 shrink-0 ml-2" />
          </a>
        ))}
      </div>
    </div>
  );
}

// Step Card
export function DocsStep({ 
  step, 
  title, 
  children 
}: { 
  step: number | string; 
  title: string; 
  children: React.ReactNode 
}) {
  return (
    <div className="flex gap-5 my-8 first:mt-0 last:mb-0">
      <div className="w-9 h-9 rounded-xl bg-surface border border-outline text-content flex items-center justify-center font-bold text-sm shrink-0 shadow-sm relative after:content-[''] after:absolute after:top-full after:left-1/2 after:-translate-x-1/2 after:w-px after:h-8 after:bg-control-hover last:after:hidden">
        {step}
      </div>
      <div className="flex-1 space-y-3 pt-1">
        <h4 className="font-bold text-lg text-content group-hover:text-blue-600 transition-colors">{title}</h4>
        <div className="text-content-secondary text-sm md:text-[15px] leading-relaxed">
          {children}
        </div>
      </div>
    </div>
  );
}

// Code Block
export function DocsCodeBlock({ 
  code, 
  language = "bash" 
}: { 
  code: string; 
  language?: string 
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group my-6 overflow-hidden rounded-xl border border-outline bg-slate-900 shadow-lg">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900/50">
        <div className="flex items-center gap-2 text-xs font-mono text-content-muted">
          <Terminal className="size-3.5" />
          {language}
        </div>
        <button 
          onClick={handleCopy}
          className="p-1.5 rounded-md hover:bg-slate-800 text-content-muted hover:text-white transition-all flex items-center gap-1.5"
        >
          <span className="text-[10px] font-medium uppercase tracking-wider">{copied ? "Copied" : "Copy"}</span>
          {copied ? <Check className="size-3.5 text-green-400" /> : <Copy className="size-3.5" />}
        </button>
      </div>
      <div className="p-5 overflow-x-auto custom-scrollbar">
        <pre className="text-sm font-mono text-slate-100 leading-relaxed">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}

// Parameter Table
export function DocsTable({ 
  headers, 
  rows 
}: { 
  headers: React.ReactNode[]; 
  rows: React.ReactNode[][] 
}) {
  return (
    <div className="my-6 w-full overflow-x-auto border border-outline rounded-xl bg-surface shadow-sm">
      <table className="w-full text-left text-[13px] text-content-secondary border-collapse">
        <thead className="bg-surface-muted border-b border-outline text-content-muted text-[11px] uppercase font-bold tracking-wider">
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="px-5 py-4 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-outline">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-surface-muted/50 transition-colors">
              {row.map((cell, j) => (
                <td key={j} className="px-5 py-4">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Troubleshoot Block
export function DocsTroubleshoot({
  issue,
  solution
}: {
  issue: string;
  solution: React.ReactNode;
}) {
  return (
    <div className="my-4 border border-outline rounded-xl overflow-hidden bg-surface shadow-sm hover:border-amber-200 transition-colors">
      <div className="bg-amber-50/30 border-b border-outline px-5 py-3.5 font-bold text-content flex items-center gap-2 text-sm">
        <AlertTriangle className="size-4 text-amber-500" />
        {issue}
      </div>
      <div className="p-5 text-sm text-content-secondary leading-relaxed bg-surface">
        {solution}
      </div>
    </div>
  );
}

// Console Path Block
export function DocsPathBlock({ path, items }: { path?: string; items?: string[] }) {
  let segments: string[] = [];
  
  try {
    if (items && Array.isArray(items)) {
      segments = items;
    } else if (path && typeof path === 'string') {
      segments = path.split(" → ");
    }
  } catch (err) {
    console.error("[DocsPathBlock] Failed to parse path:", err);
    return null;
  }

  if (segments.length === 0) return null;

  return (
    <div className="my-4 flex items-center gap-3 px-4 py-3 bg-surface-muted border border-outline rounded-xl overflow-x-auto no-scrollbar shadow-inner">
      <div className="size-6 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
        <Terminal className="size-3.5" />
      </div>
      <div className="flex items-center gap-2 whitespace-nowrap">
        {segments.map((s, i) => (
          <React.Fragment key={i}>
            <span className={cn(
              "text-[13px] font-bold tracking-tight",
              i === segments.length - 1 ? "text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md" : "text-content-muted"
            )}>
              {s}
            </span>
            {i < segments.length - 1 && <ChevronRight className="size-4 text-slate-300" />}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// Unified Template Wrapper
export function DocsSectionTemplate({
  subtitle,
  scenarios,
  consolePath,
  prerequisites,
  steps,
  verification,
  troubleshooting,
  nextSteps,
  officialLinks,
  children
}: {
  subtitle?: string;
  scenarios?: string[];
  consolePath?: string | string[];
  prerequisites?: string[];
  steps?: { title: string; content: React.ReactNode }[];
  verification?: React.ReactNode;
  troubleshooting?: { issue: string; solution: React.ReactNode }[];
  nextSteps?: string[];
  officialLinks?: { title: string; href: string }[];
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-2 duration-500 pb-20">
      {subtitle && (
        <div className="border-l-4 border-blue-500 pl-6 py-1">
          <p className="text-content-secondary text-lg leading-relaxed font-medium">
            {subtitle}
          </p>
        </div>
      )}

      {scenarios && scenarios.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {scenarios.map((s, i) => (
            <span key={i} className="px-3 py-1.5 bg-control-hover text-content-secondary text-xs font-bold rounded-full border border-outline hover:bg-surface hover:text-blue-600 hover:border-blue-200 transition-all cursor-default">
              #{s}
            </span>
          ))}
        </div>
      )}

      {children && <div className="prose prose-slate max-w-none">{children}</div>}

      {consolePath && (
        <div className="bg-surface-muted/50 p-6 rounded-2xl border border-outline">
          <h3 className="text-xs font-bold text-content-muted uppercase tracking-widest mb-3">控制台路径</h3>
          {Array.isArray(consolePath) ? (
            <DocsPathBlock items={consolePath} />
          ) : (
            <DocsPathBlock path={consolePath} />
          )}
        </div>
      )}

      {prerequisites && prerequisites.length > 0 && (
        <DocsChecklist items={prerequisites} />
      )}

      {steps && steps.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-content-muted uppercase tracking-wider mb-6 border-b border-outline pb-3 flex items-center justify-between">
            <span>操作步骤</span>
            <span className="text-[10px] bg-control-hover px-2 py-0.5 rounded-full">STEP BY STEP</span>
          </h3>
          <div className="space-y-4">
            {steps.map((s, i) => (
              <DocsStep key={i} step={i + 1} title={s.title}>
                {s.content}
              </DocsStep>
            ))}
          </div>
        </div>
      )}

      {verification && (
        <div>
          <h3 className="text-sm font-bold text-content-muted uppercase tracking-wider mb-4">验证是否成功</h3>
          <div className="p-6 rounded-2xl border border-emerald-100 bg-emerald-50/30 text-emerald-900 text-sm leading-relaxed shadow-sm flex gap-4">
            <CheckCircle2 className="size-5 text-emerald-500 shrink-0 mt-0.5" />
            <div className="space-y-2">
              <p className="font-bold">验证指标：</p>
              <div className="opacity-80">{verification}</div>
            </div>
          </div>
        </div>
      )}

      {troubleshooting && troubleshooting.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-content-muted uppercase tracking-wider mb-4">常见错误排查</h3>
          <div className="space-y-3">
            {troubleshooting.map((t, i) => (
              <DocsTroubleshoot key={i} issue={t.issue} solution={t.solution} />
            ))}
          </div>
        </div>
      )}

      {officialLinks && officialLinks.length > 0 && (
        <DocsOfficialLinks links={officialLinks} />
      )}

      {nextSteps && nextSteps.length > 0 && (
        <div className="bg-blue-50/30 p-8 rounded-3xl border border-blue-100/50">
          <h3 className="text-sm font-bold text-blue-900 uppercase tracking-wider mb-5 flex items-center gap-2">
            <Info className="size-4 text-blue-500" />
            下一步建议
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {nextSteps.map((s, i) => (
              <div key={i} className="flex items-center justify-between p-4 rounded-xl bg-surface border border-blue-100 hover:border-blue-400 hover:shadow-md transition-all cursor-pointer group">
                <span className="text-sm font-bold text-content-secondary group-hover:text-blue-600">{s}</span>
                <ChevronRight className="size-4 text-blue-300 group-hover:text-blue-500 group-hover:translate-x-1 transition-all" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
