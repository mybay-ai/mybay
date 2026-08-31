type Selection = { version: 1; instanceId: string; conversations: Record<string, string> };
type SelectionStorage = Pick<Storage, "getItem" | "setItem">;
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value) && value !== "__proto__";
const empty = (): Selection => ({ version: 1, instanceId: "", conversations: {} });

// IDs are navigation hints only. Server-authorized lists/detail determine access.
export function createChatSelectionPersistence(storage: () => SelectionStorage | null, userId: string | undefined) {
  const key = userId ? `mybay:chat-selection:v1:${encodeURIComponent(userId)}` : null;
  const read = (): Selection => {
    if (!key) return empty();
    try {
      const raw = storage()?.getItem(key);
      if (!raw || raw.length > 24000) return empty();
      const parsed = JSON.parse(raw);
      if (parsed?.version !== 1 || !parsed.conversations || typeof parsed.conversations !== "object" || Array.isArray(parsed.conversations)) return empty();
      return { version: 1, instanceId: validId(parsed.instanceId) ? parsed.instanceId : "", conversations: Object.fromEntries(Object.entries(parsed.conversations).filter(([id, value]) => validId(id) && validId(value)).slice(-64)) as Record<string, string> };
    } catch { return empty(); }
  };
  const write = (value: Selection) => { if (key) { try { storage()?.setItem(key, JSON.stringify(value)); } catch { /* Storage is optional. */ } } };
  const rememberInstance = (instanceId: string) => {
    if (validId(instanceId)) write({ ...read(), instanceId });
  };
  const rememberConversation = (instanceId: string, conversationId: string | null) => {
    if (!validId(instanceId) || (conversationId !== null && !validId(conversationId))) return;
    const saved = read();
    const entries = Object.entries(saved.conversations).filter(([id]) => id !== instanceId);
    if (conversationId) entries.push([instanceId, conversationId]);
    write({ ...saved, instanceId, conversations: Object.fromEntries(entries.slice(-64)) });
  };
  return { read, rememberInstance, rememberConversation, conversationFor: (instanceId: string) => {
    const saved = read();
    return Object.hasOwn(saved.conversations, instanceId) ? saved.conversations[instanceId] : null;
  } };
}

export async function resolveRememberedConversation<T extends { id: string }>(
  list: T[], rememberedId: string | null, loadDetail: (id: string) => Promise<T | null>,
) {
  if (!rememberedId) return { list, selectedId: list[0]?.id ?? null };
  if (list.some(item => item.id === rememberedId)) return { list, selectedId: rememberedId };
  try {
    const conversation = await loadDetail(rememberedId);
    if (conversation?.id === rememberedId) return { list: [...list, conversation], selectedId: rememberedId };
  } catch (error) {
    // A transient failure must not overwrite the remembered choice with fallback.
    if (![400, 403, 404, 410].includes((error as { status?: number })?.status ?? 0)) throw error;
  }
  return { list, selectedId: list[0]?.id ?? null };
}
