const NOTIFICATION_EVENT = "chat-workspace-notifications-changed";
const STORAGE_PREFIX = "mybay.chat-workspace.completed.";

type ChatNotificationState = { count: number; runIds: string[] };

function storageKey(userId: string) {
  return STORAGE_PREFIX + encodeURIComponent(userId || "anonymous");
}

function readState(userId: string): ChatNotificationState {
  if (typeof window === "undefined") return { count: 0, runIds: [] };
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey(userId)) || "{}");
    return {
      count: Number.isFinite(value?.count) ? Math.max(0, Math.floor(value.count)) : 0,
      runIds: Array.isArray(value?.runIds) ? value.runIds.slice(-100) : []
    };
  } catch {
    return { count: 0, runIds: [] };
  }
}

function writeState(userId: string, state: ChatNotificationState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(userId), JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(NOTIFICATION_EVENT, { detail: { userId, count: state.count } }));
}

export function getCompletedChatCount(userId: string) {
  return readState(userId).count;
}

export function markChatRunCompleted(userId: string, runId: string) {
  if (!userId || !runId || typeof window === "undefined") return 0;
  const state = readState(userId);
  if (state.runIds.includes(runId)) return state.count;
  const next = { count: state.count + 1, runIds: [...state.runIds, runId].slice(-100) };
  writeState(userId, next);
  return next.count;
}

export function clearCompletedChatNotifications(userId: string) {
  if (userId) writeState(userId, { count: 0, runIds: [] });
}

export function subscribeToChatNotifications(userId: string, callback: (count: number) => void) {
  if (typeof window === "undefined") return () => undefined;
  const onCustomEvent = (event: Event) => {
    const detail = (event as CustomEvent<{ userId?: string; count?: number }>).detail;
    if (detail?.userId === userId) callback(Number(detail.count) || 0);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey(userId)) callback(readState(userId).count);
  };
  window.addEventListener(NOTIFICATION_EVENT, onCustomEvent);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(NOTIFICATION_EVENT, onCustomEvent);
    window.removeEventListener("storage", onStorage);
  };
}
