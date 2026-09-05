// Bare links can run into Chinese prose without a separating space. Explicit
// Markdown links bypass this heuristic because their author supplied a boundary.
export function splitChatUrlToken(value: string) {
  const scheme = value.indexOf('://');
  const authorityStart = scheme < 0 ? 0 : scheme + 3;
  const suffix = value.slice(authorityStart).search(/[/?#]/u);
  const authorityEnd = suffix < 0 ? value.length : authorityStart + suffix;
  let boundary = value.length;
  let unicodeComponent = false;
  let componentStart = false;
  for (let i = authorityStart; i < value.length;) {
    const char = String.fromCodePoint(value.codePointAt(i)!);
    if (/[，。；：！？、（）【】《》“”‘’]/u.test(char)) { boundary = i; break; }
    if (i < authorityEnd) {
      if (/[^\x00-\x7f]/u.test(char)) {
        const prefix = value.slice(authorityStart, i);
        if (/^[a-z0-9.-]+(?::\d+)?$/i.test(prefix) && prefix.includes('.') && !prefix.endsWith('.')) { boundary = i; break; }
      }
    } else if ('/=?&#'.includes(char)) {
      componentStart = true; unicodeComponent = false;
    } else if (/[^\x00-\x7f]/u.test(char) && /[\p{L}\p{M}\p{N}]/u.test(char)) {
      if (!componentStart && !unicodeComponent) { boundary = i; break; }
      unicodeComponent = true; componentStart = false;
    } else { componentStart = false; }
    i += char.length;
  }
  const candidate = value.slice(0, boundary);
  const core = candidate.replace(/[\]\)}>),.;:!?]+$/u, '');
  return { core, trailing: candidate.slice(core.length) + value.slice(boundary) };
}

export function extractChatUrls(content: string): string[] {
  const urls = new Set<string>();
  // Quotes delimit command arguments; never include them in a navigation target.
  for (const match of content.matchAll(/(?:https?:\/\/|www\.)[^\s<>"'()]+/gi)) {
    let end = match[0].length;
    while (end > 0 && '*_`])}>),.;:!?，。；：！？'.includes(match[0][end - 1])) end -= 1;
    const raw = match[0].slice(0, end);
    const explicit = content.slice(0, match.index).endsWith('](');
    const core = explicit ? raw : splitChatUrlToken(raw).core;
    if (core) urls.add(/^www\./i.test(core) ? 'https://' + core : core);
  }
  return [...urls];
}
