import { describe, expect, it } from "vitest";
import { appendSseData, encodeRunSseEvent } from "./runSseProtocol";

describe("run SSE wire round trip", () => {
  it.each(["第一行\n第二行\n\n第三段", "\n\n开头与结尾\n\n", "```ts\n  const x = '中文😀';\n```", "data: fake\nevent: status\n\nid: 999", "a\r\nb\rc"])("preserves data lines: %j", text => {
    const wire = encodeRunSseEvent({ id: 1, event: "text", data: text });
    const lines: string[] = [];
    // Split every UTF-8 code point across network reads, including emoji.
    let buffer = "";
    const decoder = new TextDecoder();
    for (const byte of new TextEncoder().encode(wire)) {
      buffer += decoder.decode(Uint8Array.of(byte), { stream: true });
      if (!buffer.endsWith("\n")) continue;
      const line = buffer.slice(0, -1);
      if (line.startsWith("data:")) appendSseData(lines, line);
      buffer = "";
    }
    expect(lines.join("\n")).toBe(text.replace(/\r\n?/g, "\n"));
    expect(wire.split("\n").filter(line => line.startsWith("event:"))).toEqual(["event: text"]);
  });
});
