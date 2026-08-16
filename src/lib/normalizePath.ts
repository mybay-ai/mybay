/**
 * Strip trailing slash from a path, preserving root "/".
 * Examples:
 *   "/models/"  -> "/models"
 *   "/faq/"     -> "/faq"
 *   "/"         -> "/"
 */
export function normalizePath(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}
