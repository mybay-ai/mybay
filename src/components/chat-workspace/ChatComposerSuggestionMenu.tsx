import { Bot, Command } from "lucide-react";

import type { ComposerSuggestion } from "./chatComposerSuggestions";

type ChatComposerSuggestionMenuProps = {
  items: ComposerSuggestion[];
  selectedIndex: number;
  commandTitle: string;
  mentionTitle: string;
  noPeersText: string;
  mentionMode: boolean;
  onSelect: (item: ComposerSuggestion) => void;
  onHighlight: (index: number) => void;
};

export function ChatComposerSuggestionMenu({
  items,
  selectedIndex,
  commandTitle,
  mentionTitle,
  noPeersText,
  mentionMode,
  onSelect,
  onHighlight,
}: ChatComposerSuggestionMenuProps) {
  return (
    <div className="absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-xl border border-outline bg-surface shadow-xl shadow-slate-950/10 dark:shadow-slate-950/40" role="listbox">
      <div className="flex items-center gap-2 border-b border-outline/70 px-3 py-2 text-xs font-semibold text-content-secondary">
        {mentionMode ? <Bot className="h-3.5 w-3.5 text-violet-500" /> : <Command className="h-3.5 w-3.5 text-indigo-500" />}
        {mentionMode ? mentionTitle : commandTitle}
      </div>
      {items.length === 0 ? (
        <p className="px-3 py-3 text-xs leading-5 text-content-muted">{noPeersText}</p>
      ) : (
        <div className="max-h-64 overflow-y-auto p-1.5">
          {items.map((item, index) => {
            const title = item.kind === "command" ? `/${item.id}` : `@${item.name}`;
            const description = item.kind === "command" ? item.description : item.capabilities.join(" · ");
            const disabled = item.kind === "command" && item.disabled;
            return (
              <button
                key={`${item.kind}:${item.id}`}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                disabled={disabled}
                className={`flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors ${index === selectedIndex ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200" : "text-content hover:bg-surface-muted"} disabled:cursor-not-allowed disabled:opacity-45`}
                onMouseEnter={() => onHighlight(index)}
                onMouseDown={event => event.preventDefault()}
                onClick={() => onSelect(item)}
              >
                <span className="min-w-20 shrink-0 font-mono text-sm font-semibold">{title}</span>
                <span className="min-w-0 pt-0.5 text-xs leading-5 text-content-secondary">
                  {description || (item.kind === "mention" ? item.name : item.label)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
