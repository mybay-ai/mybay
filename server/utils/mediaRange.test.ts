import { describe, expect, it } from "vitest";
import { parseMediaByteRange } from "./mediaRange";

describe("parseMediaByteRange", () => {
  it("returns null when a full response was requested", () => {
    expect(parseMediaByteRange(undefined, 1000)).toBeNull();
  });

  it.each([
    ["bytes=0-99", { start: 0, end: 99 }],
    ["bytes=900-", { start: 900, end: 999 }],
    ["bytes=-100", { start: 900, end: 999 }],
    ["bytes=950-1200", { start: 950, end: 999 }],
  ])("parses %s", (header, expected) => {
    expect(parseMediaByteRange(header, 1000)).toEqual(expected);
  });

  it.each(["bytes=1000-", "bytes=10-9", "bytes=0-1,4-5", "items=0-5", "bytes=-0"])("rejects %s", (header) => {
    expect(parseMediaByteRange(header, 1000)).toBe("invalid");
  });
});
