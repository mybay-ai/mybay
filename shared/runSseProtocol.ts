/** Encode data as lines, including empty lines; never interpolate raw data as fields. */
export function encodeRunSseEvent(event: { id?: number; event: string; data: string }): string {
  const id = event.id === undefined ? "" : `id: ${event.id}\n`;
  return `${id}event: ${event.event}\n${event.data.replace(/\r\n?/g, "\n").split("\n").map(line => `data: ${line}`).join("\n")}\n\n`;
}

/** An empty first data line is still a line and must survive concatenation. */
export function appendSseData(lines: string[], line: string): void {
  const value = line.slice(5);
  lines.push(value.startsWith(" ") ? value.slice(1) : value);
}
