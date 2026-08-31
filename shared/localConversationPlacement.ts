export type ConversationSection = { kind: "pinned" | "recent"; projectId?: never } | { kind: "project"; projectId: string };
export type ConversationPlacement = {
  conversationId: string;
  targetId: string | null;
  section: ConversationSection;
  position: "before" | "after";
};
type RecordToPlace = { id: string; project_id?: string | null; pinned_at?: string | null; sort_order?: number | null };

export function conversationSectionKey(section: ConversationSection): string {
  return section.kind === "project" ? `project:${section.projectId}` : section.kind;
}

/** Input is the entire authorized, sorted instance history, not just the client's loaded page. */
export function placeConversation<T extends RecordToPlace>(items: T[], projectIds: string[], move: ConversationPlacement, now: string): T[] {
  const source = items.find(item => item.id === move.conversationId);
  const target = items.find(item => item.id === move.targetId);
  const sectionOf = (item: T) => item.pinned_at ? "pinned"
    : item.project_id && projectIds.includes(item.project_id) ? `project:${item.project_id}` : "recent";
  const destination = conversationSectionKey(move.section);
  if (!source || move.targetId === source.id || (move.section.kind === "project" && !projectIds.includes(move.section.projectId))
    || (move.targetId !== null && (!target || sectionOf(target) !== destination))) {
    throw new Error("CONVERSATION_ORDER_INVALID");
  }
  const moved = { ...source,
    pinned_at: move.section.kind === "pinned" ? source.pinned_at || now : null,
    // Pinning is a shortcut; preserve the original project for a later unpin.
    project_id: move.section.kind === "pinned" ? source.project_id : move.section.kind === "project" ? move.section.projectId : null,
  };
  const next = items.filter(item => item.id !== source.id);
  let index: number;
  if (target) index = next.findIndex(item => item.id === target.id) + (move.position === "after" ? 1 : 0);
  else {
    const siblingIndexes = next.flatMap((item, i) => sectionOf(item) === destination ? [i] : []);
    index = siblingIndexes.length ? (move.position === "before" ? siblingIndexes[0] : siblingIndexes[siblingIndexes.length - 1] + 1) : next.length;
  }
  next.splice(index, 0, moved);
  return next.map((item, sort_order) => ({ ...item, sort_order }));
}
