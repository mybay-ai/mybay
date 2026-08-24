type OrderedRecord = {
  id: string;
  sort_order?: number | null;
  updated_at?: string | null;
  pinned_at?: string | null;
};

function numericOrder(value: unknown): number {
  if (value === null || value === undefined || value === "") return Number.MAX_SAFE_INTEGER;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

export function sortConversationRecords<T extends OrderedRecord>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const pinnedA = Boolean(a.pinned_at);
    const pinnedB = Boolean(b.pinned_at);
    if (pinnedA !== pinnedB) return pinnedA ? -1 : 1;
    const orderDiff = numericOrder(a.sort_order) - numericOrder(b.sort_order);
    if (orderDiff !== 0) return orderDiff;
    const timeDiff = String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
    if (timeDiff !== 0) return timeDiff;
    return String(b.id).localeCompare(String(a.id));
  });
}

export function sortProjectRecords<T extends OrderedRecord>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const orderDiff = numericOrder(a.sort_order) - numericOrder(b.sort_order);
    if (orderDiff !== 0) return orderDiff;
    return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
  });
}

export function moveOrderedRecord<T extends OrderedRecord>(items: T[], id: string, direction: "up" | "down"): T[] | null {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return null;
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= items.length) return null;
  const next = [...items];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next.map((item, sortOrder) => ({ ...item, sort_order: sortOrder }));
}

export function moveConversationWithinSection<T extends OrderedRecord & { project_id?: string | null }>(items: T[], id: string, direction: "up" | "down"): T[] | null {
  const current = items.find((item) => item.id === id);
  if (!current) return null;
  const sectionIndexes = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => Boolean(item.pinned_at) === Boolean(current.pinned_at)
      && (Boolean(current.pinned_at) || (item.project_id || null) === (current.project_id || null)));
  const sectionIndex = sectionIndexes.findIndex(({ item }) => item.id === id);
  const targetSectionIndex = direction === "up" ? sectionIndex - 1 : sectionIndex + 1;
  if (sectionIndex < 0 || targetSectionIndex < 0 || targetSectionIndex >= sectionIndexes.length) return null;
  const next = [...items];
  const sourceIndex = sectionIndexes[sectionIndex].index;
  const targetIndex = sectionIndexes[targetSectionIndex].index;
  [next[sourceIndex], next[targetIndex]] = [next[targetIndex], next[sourceIndex]];
  return next.map((item, sortOrder) => ({ ...item, sort_order: sortOrder }));
}

export function mergePersistedOrder<T extends OrderedRecord>(current: T[], persisted: OrderedRecord[], sorter: (items: T[]) => T[]): T[] {
  const sortOrders = new Map(persisted.map((item) => [item.id, item.sort_order]));
  return sorter(current.map((item) => sortOrders.has(item.id) ? { ...item, sort_order: sortOrders.get(item.id) } : item));
}
