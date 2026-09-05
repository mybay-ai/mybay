import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { copyTextToClipboard } from './chatClipboard';

function plainText(children: ReactNode): string {
  return Children.toArray(children).map(child => isValidElement<{ children?: ReactNode }>(child)
    ? plainText(child.props.children) : String(child)).join('');
}

export function MarkdownCodeBlock({ children }: { children: ReactNode }) {
  const { t } = useTranslation('dashboard');
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const code = plainText(children).replace(/\n$/, '');
  const child = Children.toArray(children)[0];
  const className = isValidElement<{ className?: string }>(child) ? child.props.className || '' : '';
  const language = /(?:^|\s)language-([\w+-]+)/.exec(className)?.[1];
  const long = code.split('\n').length > 16;
  const copy = async () => {
    try {
      await copyTextToClipboard(code);
      setCopied(true); setFailed(false);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1400);
    } catch { setCopied(false); setFailed(true); }
  };
  return <div className="my-2 min-w-0 max-w-full overflow-hidden rounded-xl border border-slate-700 bg-slate-950">
    <div className="flex items-center justify-between gap-2 border-b border-slate-800 bg-slate-900 px-3 py-1.5 text-[11px] text-slate-400">
      <span>{language || t('chatWorkspace.codeBlockLabel')}</span>
      <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1 rounded px-2 py-1 text-slate-300 hover:bg-slate-800" title={t('chatWorkspace.copyCode')}>
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{t(copied ? 'chatWorkspace.codeCopied' : 'chatWorkspace.copyCode')}
      </button>
    </div>
    <pre className={`max-w-full overflow-auto whitespace-pre p-3 text-[12px] leading-5 text-slate-100 ${long && !expanded ? 'max-h-80' : ''}`}><code className={className}>{code}</code></pre>
    {long && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} className="w-full border-t border-slate-800 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800">{t(expanded ? 'chatWorkspace.collapseCode' : 'chatWorkspace.expandCode', { count: code.split('\n').length })}</button>}
    {failed && <p role="status" className="px-3 pb-2 text-xs text-amber-300">{t('chatWorkspace.copyFailed')}</p>}
  </div>;
}
