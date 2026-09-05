export type ComposerCommandId = "new" | "stop" | "model" | "agents" | "call" | "all" | "help";

export type ComposerPeer = {
  id: string;
  name: string;
  capabilities: string[];
};

export type ComposerCommandSuggestion = {
  kind: "command";
  id: ComposerCommandId;
  label: string;
  description: string;
  disabled?: boolean;
};

export type ComposerMentionSuggestion = ComposerPeer & {
  kind: "mention";
};

export type ComposerSuggestion = ComposerCommandSuggestion | ComposerMentionSuggestion;

export type ComposerTrigger = {
  kind: "command" | "mention";
  query: string;
  start: number;
  end: number;
};

export function findComposerTrigger(input: string, cursor = input.length): ComposerTrigger | null {
  const safeCursor = Math.max(0, Math.min(cursor, input.length));
  const prefix = input.slice(0, safeCursor);
  const command = prefix.match(/^\/([^\s/]*)$/);
  if (command) {
    return { kind: "command", query: command[1] || "", start: 0, end: safeCursor };
  }

  const mention = prefix.match(/(?:^|\s)@([^\s@]*)$/);
  if (!mention) return null;
  const query = mention[1] || "";
  return { kind: "mention", query, start: safeCursor - query.length - 1, end: safeCursor };
}

export function filterComposerSuggestions<T extends ComposerSuggestion>(items: T[], query: string): T[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return items;
  return items.filter(item => {
    const searchable = item.kind === "command"
      ? `${item.id} ${item.label} ${item.description}`
      : `${item.name} ${item.capabilities.join(" ")}`;
    return searchable.toLocaleLowerCase().includes(normalized);
  });
}

export function replaceComposerTrigger(input: string, trigger: ComposerTrigger, replacement: string): { value: string; cursor: number } {
  const suffix = input.slice(trigger.end);
  const normalizedReplacement = replacement.endsWith(" ") && suffix.startsWith(" ") ? replacement.slice(0, -1) : replacement;
  const value = `${input.slice(0, trigger.start)}${normalizedReplacement}${suffix}`;
  return { value, cursor: trigger.start + normalizedReplacement.length };
}
