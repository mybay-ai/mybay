export type PreferredChatMode = "quick" | "agent";
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
const MAX_SAVED_AGENTS = 64;
const validAgentId = (id: unknown): id is string => (
  typeof id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(id) && id !== "__proto__"
);
const validMode = (mode: unknown): mode is PreferredChatMode => mode === "quick" || mode === "agent";

// A next-message preference, never a source of authority about active runs or capabilities.
export function createChatModePreference(storage: () => PreferenceStorage | null, userId?: string) {
  const key = userId ? `mybay:chat-mode:v1:${encodeURIComponent(userId)}` : null;
  const read = (): Record<string, PreferredChatMode> => {
    if (!key) return {};
    try {
      const raw = storage()?.getItem(key);
      if (!raw || raw.length > 16000) return {};
      const saved = JSON.parse(raw);
      if (saved?.version !== 1 || !saved.modes || typeof saved.modes !== "object" || Array.isArray(saved.modes)) return {};
      return Object.fromEntries(Object.entries(saved.modes)
        .filter(([id, mode]) => validAgentId(id) && validMode(mode))
        .slice(-MAX_SAVED_AGENTS)) as Record<string, PreferredChatMode>;
    } catch { return {}; }
  };
  return {
    modeFor(instanceId: string): PreferredChatMode {
      const saved = read();
      return validAgentId(instanceId) && Object.hasOwn(saved, instanceId) ? saved[instanceId] : "quick";
    },
    remember(instanceId: string, mode: PreferredChatMode) {
      if (!key || !validAgentId(instanceId) || !validMode(mode)) return;
      const entries = Object.entries(read()).filter(([id]) => id !== instanceId);
      entries.push([instanceId, mode]);
      try {
        storage()?.setItem(key, JSON.stringify({ version: 1, modes: Object.fromEntries(entries.slice(-MAX_SAVED_AGENTS)) }));
      } catch { /* Persistence is optional; the in-memory selection still works. */ }
    },
  };
}
