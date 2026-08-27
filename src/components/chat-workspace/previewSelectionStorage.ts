const PREVIEW_SELECTION_PREFIX = "mybay:chat-preview-selection";
const GENERATED_PREVIEW_SELECTION_PREFIX = "mybay:generated-preview-selection";

export function previewSelectionStorageKey(instanceId: string, conversationId: string): string {
  return `${PREVIEW_SELECTION_PREFIX}:${encodeURIComponent(instanceId)}:${encodeURIComponent(conversationId)}`;
}

export function generatedPreviewSelectionStorageKey(instanceId: string, conversationId: string): string {
  return `${GENERATED_PREVIEW_SELECTION_PREFIX}:${encodeURIComponent(instanceId)}:${encodeURIComponent(conversationId)}`;
}

export function loadPreviewSelection(storage: Pick<Storage, "getItem"> | null, instanceId: string, conversationId: string): string | null {
  if (!storage || !instanceId || !conversationId) return null;
  try {
    const value = storage.getItem(previewSelectionStorageKey(instanceId, conversationId));
    return value?.trim() || null;
  } catch {
    return null;
  }
}

export function savePreviewSelection(storage: Pick<Storage, "setItem"> | null, instanceId: string, conversationId: string, fileId: string): void {
  if (!storage || !instanceId || !conversationId || !fileId) return;
  try {
    storage.setItem(previewSelectionStorageKey(instanceId, conversationId), fileId);
  } catch {
    // Preview persistence is best-effort and must not interrupt file viewing.
  }
}

export function clearPreviewSelection(storage: Pick<Storage, "removeItem"> | null, instanceId: string, conversationId: string): void {
  if (!storage || !instanceId || !conversationId) return;
  try {
    storage.removeItem(previewSelectionStorageKey(instanceId, conversationId));
  } catch {
    // Preview persistence is best-effort and must not interrupt file viewing.
  }
}

export function loadGeneratedPreviewSelection(storage: Pick<Storage, "getItem"> | null, instanceId: string, conversationId: string): string | null {
  if (!storage || !instanceId || !conversationId) return null;
  try {
    const value = storage.getItem(generatedPreviewSelectionStorageKey(instanceId, conversationId));
    return value?.trim() || null;
  } catch {
    return null;
  }
}

export function saveGeneratedPreviewSelection(storage: Pick<Storage, "setItem"> | null, instanceId: string, conversationId: string, filePath: string): void {
  if (!storage || !instanceId || !conversationId || !filePath) return;
  try {
    storage.setItem(generatedPreviewSelectionStorageKey(instanceId, conversationId), filePath);
  } catch {
    // Preview persistence is best-effort and must not interrupt file viewing.
  }
}

export function clearGeneratedPreviewSelection(storage: Pick<Storage, "removeItem"> | null, instanceId: string, conversationId: string): void {
  if (!storage || !instanceId || !conversationId) return;
  try {
    storage.removeItem(generatedPreviewSelectionStorageKey(instanceId, conversationId));
  } catch {
    // Preview persistence is best-effort and must not interrupt file viewing.
  }
}
