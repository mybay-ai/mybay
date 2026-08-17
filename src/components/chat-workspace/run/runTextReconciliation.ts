function comparableText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\.{3,}|\u2026+/g, "\u2026")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function chooseMostCompleteStreamingContent(currentContent: string, candidateContent: string): string {
  const current = currentContent || "";
  const candidate = candidateContent || "";
  if (!current) return candidate;
  if (!candidate) return current;
  const currentComparable = comparableText(current);
  const candidateComparable = comparableText(candidate);
  if (currentComparable === candidateComparable) return current.length >= candidate.length ? current : candidate;
  if (current.startsWith(candidate) || currentComparable.startsWith(candidateComparable)) return current;
  if (candidate.startsWith(current) || candidateComparable.startsWith(currentComparable)) return candidate;
  return candidateComparable.length >= currentComparable.length ? candidate : current;
}


export function mergeRecoveredStreamingContent(baselineContent: string, replayedContent: string): string {
  const baseline = baselineContent || "";
  const replayed = replayedContent || "";
  if (!baseline) return replayed;
  if (!replayed) return baseline;
  if (baseline.startsWith(replayed)) return baseline;
  if (replayed.startsWith(baseline)) return replayed;
  return baseline + replayed;
}
