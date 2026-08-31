import { describe, expect, it } from "vitest";
import { createChatModePreference, type PreferredChatMode } from "./chatModePreference";

function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe("chat mode preference", () => {
  it("restores each Agent's explicit choice across reload and keeps users separate", () => {
    const db = storage();
    const first = createChatModePreference(() => db, "alice");
    first.remember("agent-a", "agent");
    first.remember("agent-b", "quick");
    const reloaded = createChatModePreference(() => db, "alice");
    expect(reloaded.modeFor("agent-a")).toBe("agent");
    expect(reloaded.modeFor("agent-b")).toBe("quick");
    expect(createChatModePreference(() => db, "bob").modeFor("agent-a")).toBe("quick");
  });

  it("preserves a user's later Quick choice instead of inferring mode from earlier runs", () => {
    const db = storage();
    const modes = createChatModePreference(() => db, "user");
    modes.remember("agent-a", "agent");
    modes.remember("agent-a", "quick");
    expect(createChatModePreference(() => db, "user").modeFor("agent-a")).toBe("quick");
  });

  it("does not write defaults during restoration or overwrite a known Agent on fallback", () => {
    const db = storage();
    const modes = createChatModePreference(() => db, "user");
    modes.remember("agent-a", "agent");
    const before = [...db.values];
    expect(modes.modeFor("different-agent")).toBe("quick");
    expect(modes.modeFor("")).toBe("quick");
    expect([...db.values]).toEqual(before);
    expect(modes.modeFor("agent-a")).toBe("agent");
  });

  it("does not persist a temporary Assist diagnostic mode or invalid values", () => {
    const db = storage();
    const modes = createChatModePreference(() => db, "user");
    modes.remember("a", "agent");
    modes.remember("a", "assist" as PreferredChatMode);
    modes.remember("a", "invalid" as PreferredChatMode);
    modes.remember("__proto__", "agent");
    modes.remember("../private", "agent");
    expect(modes.modeFor("a")).toBe("agent");
    expect(modes.modeFor("__proto__")).toBe("quick");
    expect(JSON.parse([...db.values.values()][0])).toEqual({ version: 1, modes: { a: "agent" } });
  });

  it.each(["not json", "null", '{"version":2,"modes":{}}', '{"version":1,"modes":[]}', "x".repeat(16001)])("ignores malformed or oversized storage %#", raw => {
    const db = storage();
    const modes = createChatModePreference(() => db, "user");
    modes.remember("a", "agent");
    db.setItem([...db.values.keys()][0], raw);
    expect(modes.modeFor("a")).toBe("quick");
  });

  it("filters invalid persisted modes", () => {
    const db = storage();
    const modes = createChatModePreference(() => db, "user");
    modes.remember("a", "agent");
    db.setItem([...db.values.keys()][0], '{"version":1,"modes":{"a":"agent","b":"assist","c":true}}');
    expect(modes.modeFor("a")).toBe("agent");
    expect(modes.modeFor("b")).toBe("quick");
    expect(modes.modeFor("c")).toBe("quick");
  });

  it("supports unavailable/blocked storage without throwing and never persists anonymously", () => {
    const db = storage();
    createChatModePreference(() => db).remember("a", "agent");
    expect(db.values.size).toBe(0);
    for (const getStorage of [() => null, () => { throw new Error("storage denied"); }]) {
      const modes = createChatModePreference(getStorage, "user");
      expect(() => modes.remember("a", "agent")).not.toThrow();
      expect(modes.modeFor("a")).toBe("quick");
    }
    const readOnly = createChatModePreference(() => ({ getItem: () => null, setItem: () => { throw new Error("quota"); } }), "user");
    expect(() => readOnly.remember("a", "agent")).not.toThrow();
  });

  it("bounds saved Agents and refreshes the most recently chosen entry", () => {
    const db = storage();
    const modes = createChatModePreference(() => db, "user");
    for (let index = 0; index < 64; index++) modes.remember(`a-${index}`, "agent");
    modes.remember("a-0", "agent");
    modes.remember("a-64", "agent");
    expect(Object.keys(JSON.parse([...db.values.values()][0]).modes)).toHaveLength(64);
    expect(modes.modeFor("a-0")).toBe("agent");
    expect(modes.modeFor("a-1")).toBe("quick");
    expect(modes.modeFor("a-64")).toBe("agent");
  });
});
