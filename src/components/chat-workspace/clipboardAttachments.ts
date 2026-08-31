import type { ClipboardEvent } from "react";

// Capture at the composer boundary so file paste also works inside long-text
// cards, while ordinary text still reaches their existing paste handlers.
export function handleClipboardAttachments(
  event: ClipboardEvent<HTMLElement>,
  upload?: (files: File[]) => void,
): boolean {
  if (!upload) return false;
  let files = Array.from(event.clipboardData.files);
  if (!files.length) {
    files = Array.from(event.clipboardData.items || [])
      .filter(item => item.kind === "file")
      .map(item => item.getAsFile())
      .filter((file): file is File => file !== null);
  }
  if (!files.length) return false;
  event.preventDefault();
  event.stopPropagation();
  upload(files);
  return true;
}
