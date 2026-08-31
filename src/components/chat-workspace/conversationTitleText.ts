// Keep new automatic titles informative and within the API's 100-code-unit limit.
export function createConversationTitle(content: string, fallback: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  if (!compact) return fallback;
  if (compact.length <= 80) return compact;
  let prefix = "";
  // Iterate Unicode characters so truncation never leaves half an emoji.
  for (const character of compact) {
    if (prefix.length + character.length > 79) break;
    prefix += character;
  }
  return `${prefix.trimEnd()}…`;
}
