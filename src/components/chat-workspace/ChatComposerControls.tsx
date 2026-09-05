import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Brain, Check, ChevronDown, FolderOpen, Gauge, HelpCircle, LoaderCircle, Paperclip, Plus, Sparkles, X, Zap } from 'lucide-react';
import type { ChatAttachmentConfig } from '../../../shared/chatAttachmentContract';
import type { ChatReasoningEffort } from './ChatInputBar';
import { positionComposerPopover } from './composerPopoverPosition';
import './ChatComposerControls.css';

function handleChoiceKeys(event: KeyboardEvent<HTMLFieldSetElement>) {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  const choices = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement>('input[type="radio"]:not(:disabled)'));
  const index = choices.indexOf(event.target as HTMLInputElement);
  if (index < 0) return;
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
    : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + choices.length) % choices.length;
  event.preventDefault();
  choices[next].focus({ preventScroll: true });
  choices[next].click();
}

type ChatComposerControlsProps = {
  chatMode: 'quick' | 'assist' | 'agent';
  onChatModeChange: (mode: 'quick' | 'agent') => void;
  reasoningEffort: ChatReasoningEffort;
  onReasoningEffortChange: (effort: ChatReasoningEffort) => void;
  agentAvailable: boolean;
  attachmentCount: number;
  attachmentConfig: ChatAttachmentConfig;
  uploadExtensions: string[] | null;
  agentUnavailableMessage: string;
  isUploading: boolean;
  attachmentDisabledReason?: string;
  canUpload: boolean;
  onUpload: () => void;
  onChooseWorkspaceFiles?: () => void;
};

export function ChatComposerControls({
  chatMode, onChatModeChange, reasoningEffort, onReasoningEffortChange, agentAvailable,
  attachmentCount, attachmentConfig, uploadExtensions, agentUnavailableMessage, isUploading, attachmentDisabledReason,
  canUpload, onUpload, onChooseWorkspaceFiles,
}: ChatComposerControlsProps) {
  const { t } = useTranslation('dashboard');
  const id = useId();
  const [open, setOpen] = useState<'attachments' | 'settings' | null>(null);
  const [position, setPosition] = useState<ReturnType<typeof positionComposerPopover> | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusPending = useRef(false);
  const trigger = () => open === 'attachments' ? addRef.current : settingsRef.current;
  const close = (restoreFocus = false) => {
    if (restoreFocus) trigger()?.focus({ preventScroll: true });
    setOpen(null);
  };
  const toggle = (menu: 'attachments' | 'settings') => {
    focusPending.current = true;
    setPosition(null);
    setOpen(current => current === menu ? null : menu);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const anchor = trigger();
    if (!panel || !anchor) return;
    const updatePosition = () => {
      const viewport = window.visualViewport;
      const next = positionComposerPopover(anchor.getBoundingClientRect(), {
        left: viewport?.offsetLeft ?? 0,
        top: viewport?.offsetTop ?? 0,
        width: viewport?.width ?? window.innerWidth,
        height: viewport?.height ?? window.innerHeight,
      }, panel.scrollHeight + 2);
      setPosition(previous => previous && Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
    };
    updatePosition();
    const outside = (event: Event) => {
      const target = event.target as Node | null;
      if (target && !panel.contains(target) && !addRef.current?.contains(target) && !settingsRef.current?.contains(target)) close();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition);
    observer?.observe(panel);
    observer?.observe(anchor);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    window.visualViewport?.addEventListener('resize', updatePosition);
    window.visualViewport?.addEventListener('scroll', updatePosition);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      window.visualViewport?.removeEventListener('resize', updatePosition);
      window.visualViewport?.removeEventListener('scroll', updatePosition);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  useLayoutEffect(() => {
    // Positioning removes visibility:hidden; only then can the popup receive focus.
    if (!open || !position || !focusPending.current) return;
    focusPending.current = false;
    const panel = panelRef.current;
    (panel?.querySelector<HTMLInputElement>('input:checked:not(:disabled)')
      ?? panel?.querySelector<HTMLButtonElement>('[data-chat-attachment-action]:not(:disabled)')
      ?? panel?.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus({ preventScroll: true });
  }, [open, position]);

  const modes = [
    { id: 'quick' as const, label: t('dashboard:chatWorkspace.composerDirect'), short: t('dashboard:chatWorkspace.composerDirectShort'), desc: t('dashboard:chatWorkspace.modeQuickTooltip'), icon: Zap },
    { id: 'agent' as const, label: t('dashboard:chatWorkspace.composerAgent'), short: t('dashboard:chatWorkspace.composerAgentShort'), desc: t('dashboard:chatWorkspace.modeAgentTooltip'), icon: Sparkles },
  ];
  const activeMode = chatMode === 'assist'
    ? { label: t('dashboard:chatWorkspace.modeAssist'), short: t('dashboard:chatWorkspace.modeAssist'), desc: t('dashboard:chatWorkspace.modeAssistTooltip'), icon: HelpCircle }
    : (modes.find(mode => mode.id === chatMode) ?? modes[0]);
  const efforts = [
    { id: 'fast' as const, label: t('dashboard:chatWorkspace.reasoningEffortFast'), desc: t('dashboard:chatWorkspace.reasoningEffortFastDesc'), icon: Zap },
    { id: 'balanced' as const, label: t('dashboard:chatWorkspace.reasoningEffortBalanced'), desc: t('dashboard:chatWorkspace.reasoningEffortBalancedDesc'), icon: Gauge },
    { id: 'deep' as const, label: t('dashboard:chatWorkspace.reasoningEffortDeep'), desc: t('dashboard:chatWorkspace.reasoningEffortDeepDesc'), icon: Brain },
  ];
  const effort = efforts.find(option => option.id === reasoningEffort) ?? efforts[1];
  const ModeIcon = activeMode.icon;
  const summary = `${activeMode.short} · ${effort.label}`;
  const addLabel = t('dashboard:chatWorkspace.composerAdd');
  const title = open === 'attachments' ? addLabel : t('dashboard:chatWorkspace.composerSettings');
  const attachmentActionClass = 'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-content-secondary transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';

  return <>
    <div data-chat-composer-files className="shrink-0">
      <button ref={addRef} type="button" onClick={() => toggle('attachments')}
        className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-content-muted transition-colors hover:bg-surface-muted hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 md:h-8 md:w-8"
        aria-label={addLabel} title={attachmentDisabledReason || addLabel} aria-haspopup="dialog" aria-expanded={open === 'attachments'} aria-controls={open === 'attachments' ? `${id}-panel` : undefined}>
        {isUploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-[18px] w-[18px]" />}
        {attachmentCount > 0 && <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 min-w-3.5 rounded-full bg-indigo-600 px-0.5 text-center text-[9px] font-semibold leading-3.5 text-white">{attachmentCount}</span>}
      </button>
    </div>
    <div data-chat-composer-options className="chat-composer-options min-w-[5.5rem] flex-auto">
      <button ref={settingsRef} type="button" onClick={() => toggle('settings')}
        className="inline-flex h-10 max-w-full items-center gap-1 rounded-lg border border-outline bg-surface-muted px-1.5 text-xs font-semibold text-content-secondary transition-colors hover:bg-surface-muted hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 md:h-8"
        aria-label={summary} title={`${summary} — ${activeMode.desc}`} aria-haspopup="dialog" aria-expanded={open === 'settings'} aria-controls={open === 'settings' ? `${id}-panel` : undefined}>
        <ModeIcon className="chat-composer-mode-icon h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate" aria-hidden="true">
          <span className="chat-composer-mode-full">{activeMode.short}</span>
          <span className="chat-composer-mode-short">{activeMode.short}</span>
        </span>
        <span className="chat-composer-effort-summary shrink-0 items-center gap-1 text-content-muted" aria-hidden="true"><span>·</span>{effort.label}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-content-muted" />
      </button>
    </div>
    {open && typeof document !== 'undefined' && createPortal(
      <div ref={panelRef} id={`${id}-panel`} role="dialog" aria-labelledby={`${id}-title`} data-chat-composer-popover={open}
        className="fixed z-[110] overflow-y-auto overscroll-contain rounded-2xl border border-outline bg-surface p-2 text-content shadow-xl shadow-slate-950/15 dark:shadow-black/40"
        style={position || { left: 0, top: 0, width: 304, visibility: 'hidden' }}>
        <div className="mb-1 flex items-center justify-between gap-2 px-2">
          <h3 id={`${id}-title`} className="text-xs font-semibold text-content-muted">{title}</h3>
          <button type="button" onClick={() => close(true)} aria-label={t('dashboard:chatWorkspace.composerClose')} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-content-muted hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"><X className="h-3.5 w-3.5" /></button>
        </div>
        {open === 'attachments' ? <>
          <button type="button" data-chat-attachment-action="upload" disabled={!canUpload} className={attachmentActionClass} onClick={() => { if (!canUpload) return; close(true); onUpload(); }}>
            <Paperclip className="h-4 w-4 shrink-0" />{t('dashboard:chatWorkspace.attachmentEntry')}
          </button>
          {onChooseWorkspaceFiles && <button type="button" data-chat-attachment-action="workspace" disabled={!canUpload} className={attachmentActionClass} onClick={() => { if (!canUpload) return; close(true); onChooseWorkspaceFiles(); }}>
            <FolderOpen className="h-4 w-4 shrink-0" />{t('chatWorkspace.workspaceAttachTitle')}
          </button>}
          <p className="mt-1 border-t border-outline px-3 pt-2 text-xs leading-5 text-content-muted" role={attachmentDisabledReason ? 'status' : undefined}>
            {attachmentDisabledReason || t(attachmentConfig.maxFiles === null ? 'chatWorkspace.composerAttachmentCountUnlimited' : 'chatWorkspace.composerAttachmentCount', { count: attachmentCount, max: attachmentConfig.maxFiles ?? 0 })}
          </p>
          <p className="px-3 pt-1 text-xs leading-5 text-content-muted">{attachmentConfig.maxFileSizeBytes === null
            ? t('chatWorkspace.composerSizeUnlimited')
            : t('chatWorkspace.composerSizeLimit', { size: new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(attachmentConfig.maxFileSizeBytes / 1024 / 1024) })}</p>
          <p className="break-words px-3 pt-1 text-xs leading-5 text-content-muted">{uploadExtensions === null
            ? t('chatWorkspace.composerTypesUnlimited')
            : t('chatWorkspace.composerTypes', { types: uploadExtensions.length ? uploadExtensions.join(', ') : t('chatWorkspace.composerNoTypes') })}</p>
          <p className="px-3 pt-1 text-xs leading-5 text-content-muted">{t('chatWorkspace.composerUploadHint')}</p>
        </> : <div className="space-y-3">
          <fieldset className="min-w-0" onKeyDown={handleChoiceKeys}>
            <legend className="px-2 pb-1 text-xs font-medium text-content-muted">{t('dashboard:chatWorkspace.composerModeLabel')}</legend>
            {chatMode === 'assist' && <p className="px-2 pb-2 text-xs text-content-muted">{activeMode.label} · {activeMode.desc}</p>}
            {modes.map(mode => {
              const Icon = mode.icon;
              const disabled = mode.id === 'agent' && !agentAvailable;
              return <label key={mode.id} className="relative block" title={disabled ? agentUnavailableMessage : undefined}>
                <input className="peer sr-only" type="radio" name={`${id}-mode`} value={mode.id} checked={chatMode === mode.id} disabled={disabled} aria-label={mode.label}
                  onChange={() => { if (!disabled) onChatModeChange(mode.id); }} />
                <span className="block cursor-pointer rounded-xl px-3 py-2 text-content-secondary transition-colors hover:bg-surface-muted peer-checked:bg-indigo-50 peer-checked:text-indigo-700 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 peer-disabled:cursor-not-allowed peer-disabled:opacity-45 dark:peer-checked:bg-indigo-500/15 dark:peer-checked:text-indigo-200">
                  <span className="flex items-center gap-2 text-[13px] font-semibold"><Icon className="h-3.5 w-3.5 shrink-0" />{mode.label}{chatMode === mode.id && <Check className="ml-auto h-3.5 w-3.5" />}</span>
                  <span className="mt-1 block text-xs leading-4 opacity-80">{disabled ? agentUnavailableMessage : mode.desc}</span>
                </span>
              </label>;
            })}
          </fieldset>
          <fieldset className="min-w-0 border-t border-outline px-2 pt-2" onKeyDown={handleChoiceKeys}>
            <legend className="px-1 text-xs font-medium text-content-muted">{t('dashboard:chatWorkspace.composerEffortLabel')}</legend>
            <div className="grid grid-cols-3 gap-1">
              {efforts.map(option => {
                const Icon = option.icon;
                return <label key={option.id} className="relative min-w-0" title={option.desc}>
                  <input className="peer sr-only" type="radio" name={`${id}-effort`} value={option.id} checked={reasoningEffort === option.id} aria-label={option.label} aria-describedby={`${id}-effort-description`}
                    onChange={() => onReasoningEffortChange(option.id)} />
                  <span className="flex min-h-10 cursor-pointer items-center justify-center gap-1 rounded-lg border border-outline px-1 text-xs font-medium text-content-secondary transition-colors hover:bg-surface-muted peer-checked:border-indigo-400 peer-checked:bg-indigo-50 peer-checked:text-indigo-700 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 dark:peer-checked:bg-indigo-500/15 dark:peer-checked:text-indigo-200"><Icon className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{option.label}</span></span>
                </label>;
              })}
            </div>
            <p id={`${id}-effort-description`} className="mt-2 min-h-8 text-xs leading-4 text-content-muted">{effort.desc}</p>
          </fieldset>
        </div>}
      </div>, document.body,
    )}
  </>;
}
