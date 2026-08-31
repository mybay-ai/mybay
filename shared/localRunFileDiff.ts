/** Immutable observations of a task window, not a per-tool filesystem audit. */
export type LocalFileDiff = {
  path: string;
  before: string | null;
  after: string | null;
};
export type LocalRunFileDiffs = {
  version: 1;
  runId: string;
  conversationId: string;
  capturedBefore: string;
  capturedAfter: string;
  files: LocalFileDiff[];
};
export type FileDiffResponse =
  | { available: true; file: LocalFileDiff; capturedBefore: string; capturedAfter: string }
  | { available: false };

export type DiffLine = { kind: "same" | "added" | "removed"; text: string; before?: number; after?: number };

/** Bounded LCS. Very large edits use an exact delete/insert block, never guessed matches. */
export function buildFileDiffLines(before: string | null, after: string | null): DiffLine[] {
  const a = before === null || before === "" ? [] : before.split("\n");
  const b = after === null || after === "" ? [] : after.split("\n");
  const lines: DiffLine[] = [];
  let i = 0, j = 0;
  const pushSame = () => { lines.push({ kind: "same", text: a[i], before: ++i, after: ++j }); };
  while (i < a.length && j < b.length && a[i] === b[j]) pushSame();
  let endA = a.length, endB = b.length;
  while (endA > i && endB > j && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const width = endB - j + 1;
  if ((endA - i + 1) * width <= 200_000) {
    const startI = i, startJ = j;
    const cells = new Uint16Array((endA - i + 1) * width);
    for (let x = endA - 1; x >= i; x--) for (let y = endB - 1; y >= j; y--) {
      const k = (x - startI) * width + y - startJ;
      cells[k] = a[x] === b[y] ? cells[k + width + 1] + 1 : Math.max(cells[k + width], cells[k + 1]);
    }
    while (i < endA && j < endB) {
      if (a[i] === b[j]) pushSame();
      else if (cells[(i - startI + 1) * width + j - startJ] >= cells[(i - startI) * width + j - startJ + 1]) lines.push({ kind: "removed", text: a[i], before: ++i });
      else lines.push({ kind: "added", text: b[j], after: ++j });
    }
  }
  while (i < endA) lines.push({ kind: "removed", text: a[i], before: ++i });
  while (j < endB) lines.push({ kind: "added", text: b[j], after: ++j });
  while (i < a.length && j < b.length) pushSame();
  return lines;
}
