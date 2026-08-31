import { useEffect, useRef, useState } from "react";
import type { DragEvent, PointerEvent } from "react";
import { conversationSectionKey, type ConversationPlacement, type ConversationSection } from "../../../shared/localConversationPlacement";

export function useConversationSidebarDrag(instanceId: string, disabled: boolean, onPlace: (move: ConversationPlacement) => void, expand: (key: string) => void) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [over, setOver] = useState<{ key: string; position: "before" | "after" } | null>(null);
  const sourceRef = useRef<string | null>(null);
  const pointerRef = useRef<{ id: string; x: number; y: number; active: boolean } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const speedRef = useRef(0);
  const expandRef = useRef<{ key: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const clearExpand = () => { if (expandRef.current) clearTimeout(expandRef.current.timer); expandRef.current = null; };
  const reset = () => { pointerRef.current = null; sourceRef.current = null; setDraggedId(null); setOver(null); speedRef.current = 0; clearExpand(); };
  useEffect(() => { reset(); return clearExpand; }, [instanceId, disabled]); // Reset cross-instance and interrupted drags.
  useEffect(() => {
    if (!draggedId) return;
    let frame: number;
    const tick = () => { if (scrollRef.current && speedRef.current) scrollRef.current.scrollTop += speedRef.current; frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [draggedId]);

  const accepts = (event: DragEvent) => !disabled && sourceRef.current && !event.dataTransfer.types.includes("Files")
    && event.dataTransfer.types.includes("application/x-mybay-local-conversation");
  const targetProps = (section: ConversationSection, targetId: string | null = null) => ({
    "data-conversation-drop-kind": section.kind,
    "data-conversation-drop-project": section.kind === "project" ? section.projectId : undefined,
    "data-conversation-drop-id": targetId || undefined,
    onDragOver(event: DragEvent<HTMLElement>) {
      if (!accepts(event) || targetId === sourceRef.current) return;
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move";
      const rect = event.currentTarget.getBoundingClientRect();
      const position = targetId && event.clientY < rect.top + rect.height / 2 ? "before" : "after";
      const key = targetId || conversationSectionKey(section);
      setOver({ key, position });
      if (targetId) clearExpand();
      else if (expandRef.current?.key !== key) {
        clearExpand(); expandRef.current = { key, timer: setTimeout(() => expand(key), 600) };
      }
    },
    onDragLeave(event: DragEvent<HTMLElement>) {
      if (!event.currentTarget.contains(event.relatedTarget instanceof Node ? event.relatedTarget : null)) { setOver(null); clearExpand(); }
    },
    onDrop(event: DragEvent<HTMLElement>) {
      if (!accepts(event)) return;
      event.preventDefault(); event.stopPropagation();
      const source = sourceRef.current;
      const rect = event.currentTarget.getBoundingClientRect();
      const position = targetId && event.clientY < rect.top + rect.height / 2 ? "before" : "after";
      if (source && source !== targetId) { expand(conversationSectionKey(section)); onPlace({ conversationId: source, targetId, section, position }); }
      reset();
    },
  });
  const pointTarget = (x: number, y: number) => {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-conversation-drop-kind]");
    if (!element || !scrollRef.current?.contains(element)) return null;
    const kind = element.dataset.conversationDropKind;
    const projectId = element.dataset.conversationDropProject;
    const section: ConversationSection | null = kind === "project" && projectId ? { kind, projectId } : kind === "recent" || kind === "pinned" ? { kind } : null;
    if (!section) return null;
    const targetId = element.dataset.conversationDropId || null;
    if (targetId === pointerRef.current?.id) return null;
    const rect = element.getBoundingClientRect();
    const position = targetId && y < rect.top + rect.height / 2 ? "before" as const : "after" as const;
    return { section, targetId, position, key: targetId || conversationSectionKey(section) };
  };
  return { draggedId, over, scrollRef, targetProps, reset,
    pointerStart(event: PointerEvent<HTMLButtonElement>, id: string) {
      if (disabled || event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      pointerRef.current = { id, x: event.clientX, y: event.clientY, active: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    pointerMove(event: PointerEvent<HTMLButtonElement>) {
      const pointer = pointerRef.current;
      if (!pointer || disabled) return;
      if (!pointer.active && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) < 6) return;
      if (!pointer.active) { pointer.active = true; setDraggedId(pointer.id); }
      const target = pointTarget(event.clientX, event.clientY);
      setOver(target ? { key: target.key, position: target.position } : null);
      if (!target || target.targetId) clearExpand();
      else if (expandRef.current?.key !== target.key) {
        clearExpand(); expandRef.current = { key: target.key, timer: setTimeout(() => expand(target.key), 600) };
      }
      const rect = scrollRef.current?.getBoundingClientRect();
      speedRef.current = rect && event.clientX >= rect.left && event.clientX <= rect.right
        ? event.clientY < rect.top + 40 ? -7 : event.clientY > rect.bottom - 40 ? 7 : 0 : 0;
    },
    pointerEnd(event: PointerEvent<HTMLButtonElement>) {
      const pointer = pointerRef.current;
      const target = pointer?.active && !disabled ? pointTarget(event.clientX, event.clientY) : null;
      if (target && pointer) { expand(conversationSectionKey(target.section)); onPlace({ conversationId: pointer.id, targetId: target.targetId, section: target.section, position: target.position }); }
      reset();
    },
    start(event: DragEvent<HTMLElement>, id: string) {
      if (disabled || (event.target as HTMLElement).closest('button[aria-haspopup], input')) { event.preventDefault(); return; }
      sourceRef.current = id; setDraggedId(id);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-mybay-local-conversation", id);
    },
    scroll(event: DragEvent<HTMLElement>) {
      if (!accepts(event) || !scrollRef.current) return;
      const rect = scrollRef.current.getBoundingClientRect();
      speedRef.current = event.clientY < rect.top + 40 ? -7 : event.clientY > rect.bottom - 40 ? 7 : 0;
    },
    stopScroll() { speedRef.current = 0; },
  };
}
