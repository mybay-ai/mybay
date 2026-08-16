const NON_SLUG_CHARACTERS = /[^a-z0-9\u3400-\u9fff_-]+/g;

export function slugifyHeading(value: string): string {
  const slug = value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/["'`’“”]/g, "")
    .replace(/\s+/g, "-")
    .replace(NON_SLUG_CHARACTERS, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "section";
}

export function createHeadingSlugger() {
  const counts = new Map<string, number>();
  return (value: string): string => {
    const base = slugifyHeading(value);
    const count = (counts.get(base) || 0) + 1;
    counts.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  };
}

export function normalizeDocumentId(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.md$/i, "");
}

export function documentHref(id: string): string {
  return `/docs/${normalizeDocumentId(id)}`;
}
