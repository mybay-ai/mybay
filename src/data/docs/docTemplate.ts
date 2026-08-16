import { StructuredDoc } from "./types";

/**
 * Keep the local-edition documentation registry declarative.
 *
 * Each document owns its prerequisites, troubleshooting notes, and next steps.
 * This avoids injecting hosted-edition account, quota, or role assumptions into
 * the single-administrator open-source build.
 */
export function applyStructuredDocTemplate(docs: StructuredDoc[]): StructuredDoc[] {
  return docs;
}
