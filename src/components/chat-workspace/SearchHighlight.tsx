export function SearchHighlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim();
  if (!needle) return <>{text}</>;
  // Literal matching keeps user input out of regular expressions and HTML.
  const lower = text.toLocaleLowerCase();
  const target = needle.toLocaleLowerCase();
  const parts = [];
  let offset = 0;
  let index = lower.indexOf(target, offset);
  while (index >= 0) {
    parts.push(text.slice(offset, index));
    parts.push(<mark key={index} className="rounded bg-amber-200/70 text-inherit dark:bg-amber-500/30">{text.slice(index, index + needle.length)}</mark>);
    offset = index + needle.length;
    index = lower.indexOf(target, offset);
  }
  parts.push(text.slice(offset));
  return <>{parts}</>;
}
