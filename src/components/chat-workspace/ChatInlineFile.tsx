import { useState } from 'react';
import { Archive, FileCode, FileText, Image, Sheet } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { copyTextToClipboard } from './chatClipboard';

export function ChatInlineFile({ path, isUser, onOpen }: { path: string; isUser: boolean; onOpen: () => void }) {
  const { t } = useTranslation('dashboard');
  const [showPath, setShowPath] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const name = path.replace(/\\/g, '/').split('/').pop() || path;
  const Icon = /\.(png|jpe?g|webp|gif|svg)$/i.test(name) ? Image : /\.(xlsx?|csv|tsv)$/i.test(name) ? Sheet
    : /\.(zip|tar|gz|7z|rar)$/i.test(name) ? Archive : /\.(py|[cm]?js|tsx?|jsx|sh|ps1|html|css|json|ya?ml|toml|sql|rs|go)$/i.test(name) ? FileCode : FileText;
  return <span className={`mx-0.5 inline-flex max-w-[calc(100%_-_0.25rem)] flex-wrap items-center rounded-md border align-baseline text-[13px] ${isUser ? 'border-white/25 bg-white/10 text-white' : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-200'}`}>
    <button type="button" onClick={onOpen} title={path} aria-label={`${t('chatWorkspace.openFile')}: ${path}`} className="inline-flex min-w-0 flex-1 items-center gap-1 px-1.5 py-0.5 hover:underline">
      <Icon className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{name}</span>
    </button>
    <button type="button" onClick={() => setShowPath(value => !value)} aria-expanded={showPath} aria-label={`${t('chatWorkspace.showFilePath')}: ${path}`} title={t('chatWorkspace.showFilePath')} className="shrink-0 border-l border-current/15 px-1.5 py-0.5">…</button>
    {showPath && <span className="flex w-full min-w-0 flex-wrap items-center gap-1 border-t border-current/15 p-1.5">
      <span className="min-w-0 flex-1 break-all font-mono text-xs">{path}</span>
      <button type="button" className="rounded px-1 py-0.5 text-xs underline" onClick={() => { void copyTextToClipboard(path).then(() => setCopyState('copied'), () => setCopyState('failed')); }}>{t(copyState === 'copied' ? 'chatWorkspace.pathCopied' : 'chatWorkspace.copyFilePath')}</button>
      {copyState === 'failed' && <span role="status" className="w-full text-xs">{t('chatWorkspace.copyFailed')}</span>}
    </span>}
  </span>;
}
