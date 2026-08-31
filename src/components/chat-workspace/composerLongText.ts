export const LONG_TEXT_PASTE_CHAR_THRESHOLD = 1500;
export const LONG_TEXT_PASTE_LINE_THRESHOLD = 20;
export const LONG_TEXT_TYPED_SUGGESTION_THRESHOLD = 3000;

export type PendingLongTextBlock = {
  id: string;
  leadingText: string;
  content: string;
};

export type ComposerDraft = { blocks: PendingLongTextBlock[]; input: string };

export function shouldCollapsePastedText(value: string): boolean {
  return Array.from(value).length >= LONG_TEXT_PASTE_CHAR_THRESHOLD
    || value.split(/\r\n|\r|\n/).length >= LONG_TEXT_PASTE_LINE_THRESHOLD;
}

export function longTextTitle(value: string): string {
  const firstLine = value.split(/\r\n|\r|\n/).find(line => line.trim())?.trim() || "";
  const characters = Array.from(firstLine);
  return characters.length > 48 ? characters.slice(0, 48).join("") + "…" : firstLine;
}

// The cards are a presentation detail: do not insert separators or truncate the payload.
export function serializeLongTextDraft(blocks: PendingLongTextBlock[], input: string): string {
  return blocks.map(block => block.leadingText + block.content).join("") + input;
}

export function insertLongText(
  draft: ComposerDraft,
  content: string,
  start: number,
  end: number,
  id: string,
  beforeId?: string,
): ComposerDraft {
  const index = beforeId === undefined ? draft.blocks.length : draft.blocks.findIndex(block => block.id === beforeId);
  if (index < 0 || !content) return draft;
  const text = index === draft.blocks.length ? draft.input : draft.blocks[index].leadingText;
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  const blocks = [...draft.blocks];
  const remainder = text.slice(to);
  if (index < blocks.length) blocks[index] = { ...blocks[index], leadingText: remainder };
  blocks.splice(index, 0, { id, content, leadingText: text.slice(0, from) });
  return { blocks, input: index === draft.blocks.length ? remainder : draft.input };
}

// Removing a card removes only its content. Expanding it restores content in place.
export function unfoldLongText(draft: ComposerDraft, id: string, remove = false): ComposerDraft {
  const index = draft.blocks.findIndex(block => block.id === id);
  if (index < 0) return draft;
  const blocks = [...draft.blocks];
  const [target] = blocks.splice(index, 1);
  const prefix = target.leadingText + (remove ? "" : target.content);
  if (blocks[index]) {
    blocks[index] = { ...blocks[index], leadingText: prefix + blocks[index].leadingText };
    return { blocks, input: draft.input };
  }
  return { blocks, input: prefix + draft.input };
}
