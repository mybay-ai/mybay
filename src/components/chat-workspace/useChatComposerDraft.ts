import { useRef, useState } from "react";
import { insertLongText, unfoldLongText, type ComposerDraft } from "./composerLongText";

export function useChatComposerDraft() {
  const [draft, setDraft] = useState<ComposerDraft>({ blocks: [], input: "" });
  const nextId = useRef(0);
  const setInput = (input: string) => setDraft(previous => ({ ...previous, input }));
  const replaceInput = (input: string) => setDraft({ blocks: [], input });
  const insert = (content: string, start: number, end: number, beforeId?: string) => {
    // UI-only identity; no server requests or secure-random dependency while pasting.
    const id = `long-text-${++nextId.current}`;
    setDraft(previous => insertLongText(previous, content, start, end, id, beforeId));
  };
  const update = (id: string, field: "leadingText" | "content", value: string) => {
    setDraft(previous => ({ ...previous, blocks: previous.blocks.map(block => (
      block.id === id ? { ...block, [field]: value } : block
    )) }));
  };
  const unfold = (id: string, remove = false) => setDraft(previous => unfoldLongText(previous, id, remove));
  return { input: draft.input, blocks: draft.blocks, setInput, replaceInput, insert, update, unfold };
}
