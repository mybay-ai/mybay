export const buildWorkspaceFileContextKey = (instanceId: string, conversationId: string | null) => (
  instanceId && conversationId ? `${instanceId}:${conversationId}` : ""
);

export function selectWorkspaceFileContextValue<T>(
  value: T,
  valueContextKey: string | undefined,
  instanceId: string,
  conversationId: string | null
): T | null {
  const selectedContextKey = buildWorkspaceFileContextKey(instanceId, conversationId);
  return selectedContextKey && valueContextKey === selectedContextKey ? value : null;
}
