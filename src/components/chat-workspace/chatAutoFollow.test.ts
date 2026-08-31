import { describe, expect, it, vi } from "vitest";
import { captureChatReadingAnchor, centerChatMessage, createChatAutoFollow, isNearChatBottom, restoreChatReadingAnchor } from "./chatAutoFollow";

function setup(initiallyFollowing = true) {
  class Pane extends EventTarget {
    scrollHeight = 1000;
    clientHeight = 200;
    clientTop = 2;
    top = 100;
    position = 0;
    get scrollTop() { return this.position; }
    set scrollTop(value: number) { this.position = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); }
    closest() { return null; }
    getBoundingClientRect() { return { top: this.top }; }
    querySelectorAll() { return rows; }
    contains(row: unknown) { return rows.includes(row as typeof rows[number]); }
  }
  const pane = new Pane();
  const rows = Array.from({ length: 10 }, (_, id) => ({
    id, y: id * 100, height: 100,
    getBoundingClientRect() { const top = pane.top + pane.clientTop + this.y - pane.scrollTop; return { top, bottom: top + this.height, height: this.height }; },
  }));
  let time = 1000;
  let nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const pointerTarget = new EventTarget();
  const onFollowingChange = vi.fn();
  const onPause = vi.fn();
  const controller = createChatAutoFollow(pane as unknown as HTMLElement, {
    initiallyFollowing, onFollowingChange, onPause,
    runtime: { now: () => time, pointerTarget: pointerTarget as Window,
      requestFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; },
      cancelFrame: id => { frames.delete(id); },
    },
  });
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(time)); };
  const event = (type: string, properties: Record<string, unknown> = {}) => {
    const value = new Event(type, { cancelable: true });
    Object.entries(properties).forEach(([key, property]) => Object.defineProperty(value, key, { value: property }));
    pane.dispatchEvent(value);
    return value;
  };
  const move = (top: number) => { pane.scrollTop = top; event("scroll"); };
  const readHistory = () => { controller.follow(); flush(); event("wheel", { deltaY: -100 }); move(400); };
  return { pane, rows, frames, controller, flush, event, move, readHistory, pointerTarget, onFollowingChange, onPause, advance: () => { time += 1000; } };
}

describe("chat auto-follow controller", () => {
  it("uses a small near-bottom threshold including fractional scroll positions", () => {
    expect(isNearChatBottom({ scrollHeight: 1000, clientHeight: 200, scrollTop: 736.1 })).toBe(true);
    expect(isNearChatBottom({ scrollHeight: 1000, clientHeight: 200, scrollTop: 735 })).toBe(false);
  });
  it("coalesces streaming revisions and uses the latest height without smooth-scroll queues", () => {
    const f = setup();
    for (let n = 0; n < 100; n++) f.controller.update();
    expect(f.frames.size).toBe(1);
    f.pane.scrollHeight = 1700;
    f.flush();
    expect(f.pane.scrollTop).toBe(1500);
    expect(f.frames.size).toBe(0);
  });
  it("upward wheel cancels a pending follow before the browser scrolls", () => {
    const f = setup(); f.controller.update();
    f.event("wheel", { deltaY: -1 });
    expect(f.frames.size).toBe(0);
    expect(f.controller.isFollowing()).toBe(false);
    expect(f.onPause).toHaveBeenCalledOnce();
  });
  it("preserves a paused reader while output grows below the viewport", () => {
    const f = setup(); f.readHistory();
    f.pane.scrollHeight += 900; f.controller.update(); f.flush();
    expect(f.pane.scrollTop).toBe(400);
    expect(f.controller.isFollowing()).toBe(false);
  });
  it("downward scrolling near the bottom resumes following, upward within threshold does not", () => {
    const f = setup(); f.controller.follow(); f.flush();
    f.event("wheel", { deltaY: -10 }); f.move(790);
    expect(f.controller.isFollowing()).toBe(false);
    f.event("wheel", { deltaY: 10 }); f.move(800); f.flush();
    expect(f.controller.isFollowing()).toBe(true);
  });
  it("jump to latest explicitly resumes after a pause", () => {
    const f = setup(); f.readHistory(); f.controller.follow(); f.flush();
    expect(f.pane.scrollTop).toBe(800);
    expect(f.onFollowingChange.mock.calls.map(call => call[0])).toEqual([false, true]);
  });
  it("retains the current visible row when older history arrives after more user scrolling", () => {
    const f = setup(); f.readHistory(); f.move(520); f.controller.prepareForPrepend();
    f.rows.forEach(row => { row.y += 300; }); f.pane.scrollHeight += 300;
    f.controller.update(); f.flush();
    expect(f.pane.scrollTop).toBe(820);
    expect(f.rows[5].getBoundingClientRect().top).toBe(82);
  });
  it("does not confuse appended stream height with prepended history height", () => {
    const f = setup(); f.readHistory(); f.controller.prepareForPrepend();
    f.rows.forEach(row => { row.y += 300; }); f.pane.scrollHeight += 1000;
    f.controller.update(); f.flush();
    expect(f.pane.scrollTop).toBe(700);
  });
  it("retains the visible row when an earlier image expands", () => {
    const f = setup(); f.readHistory();
    f.rows.slice(2).forEach(row => { row.y += 240; }); f.pane.scrollHeight += 240;
    f.controller.update(); f.flush();
    expect(f.pane.scrollTop).toBe(640);
  });
  it.each([true, false])("handles composer/viewport resize while following=%s", following => {
    const f = setup(); if (following) { f.controller.follow(); f.flush(); } else f.readHistory();
    f.pane.clientHeight = 120; f.controller.update(); f.flush();
    expect(f.pane.scrollTop).toBe(following ? 880 : 400);
  });
  it("does not fight a scrollbar drag and detaches when dragged up", () => {
    const f = setup(); f.controller.follow(); f.flush();
    f.event("pointerdown"); f.controller.update(); expect(f.frames.size).toBe(0);
    f.move(320); f.pointerTarget.dispatchEvent(new Event("pointerup")); f.flush();
    expect(f.controller.isFollowing()).toBe(false);
    expect(f.pane.scrollTop).toBe(320);
  });
  it("pointer cancellation resumes updates without leaving a stuck drag", () => {
    const f = setup(); f.event("pointerdown"); f.pointerTarget.dispatchEvent(new Event("pointercancel")); f.flush();
    expect(f.pane.scrollTop).toBe(800);
  });
  it("touch movement toward older messages pauses before a pending frame", () => {
    const f = setup(); f.controller.update();
    f.event("touchstart", { touches: [{ clientY: 10 }] });
    f.event("touchmove", { touches: [{ clientY: 80 }] });
    expect(f.controller.isFollowing()).toBe(false);
    expect(f.frames.size).toBe(0);
  });
  it.each(["ArrowUp", "PageUp", "Home", " "])("keyboard %s pauses, End follows", key => {
    const f = setup(); f.controller.follow(); f.flush();
    f.event("keydown", { key, shiftKey: true });
    expect(f.controller.isFollowing()).toBe(false);
    expect(f.event("keydown", { key: "End" }).defaultPrevented).toBe(true);
    f.flush(); expect(f.controller.isFollowing()).toBe(true);
  });
  it("ignores editing/control keyboard events, zoom gestures, and non-overflow wheel", () => {
    const f = setup();
    f.event("keydown", { key: "Home", target: { closest: () => ({}) } });
    f.event("wheel", { deltaY: -1, ctrlKey: true });
    f.pane.scrollHeight = 100; f.event("wheel", { deltaY: -1 });
    expect(f.controller.isFollowing()).toBe(true);
  });
  it("does not treat layout-induced scrolling as user intent", () => {
    const f = setup(); f.controller.follow(); f.flush(); f.advance();
    f.pane.clientHeight = 300; f.move(700); f.controller.update(); f.flush();
    expect(f.controller.isFollowing()).toBe(true);
    expect(f.pane.scrollTop).toBe(700);
  });
  it("search reveal is pane-scoped and pauses automatic following", () => {
    const f = setup(); f.controller.follow(); f.flush();
    f.controller.reveal(f.rows[3] as unknown as HTMLElement);
    expect(f.controller.isFollowing()).toBe(false);
    expect(f.pane.scrollTop).toBe(250);
    f.pane.scrollHeight += 800; f.controller.update(); f.flush();
    expect(f.pane.scrollTop).toBe(250);
  });
  it("does not restore history if the user resumed following before it arrived", () => {
    const f = setup(); f.readHistory(); f.controller.follow(); f.flush(); f.controller.prepareForPrepend();
    f.pane.scrollHeight += 500; f.controller.update(); f.flush();
    expect(f.pane.scrollTop).toBe(1300);
  });
  it("disposes event listeners and outstanding frames on conversation change/unmount", () => {
    const f = setup(); f.controller.update(); f.controller.dispose();
    expect(f.frames.size).toBe(0);
    f.event("wheel", { deltaY: -100 }); f.controller.update(); f.controller.follow(); f.flush();
    expect(f.onFollowingChange).not.toHaveBeenCalled();
    expect(f.pane.scrollTop).toBe(0);
  });
  it("falls back safely when the visible row is removed and centers tall messages at their start", () => {
    const f = setup(); f.pane.scrollTop = 320;
    const anchor = captureChatReadingAnchor(f.pane as unknown as HTMLElement);
    f.rows.splice(3, 1); f.pane.scrollTop = 0;
    restoreChatReadingAnchor(f.pane as unknown as HTMLElement, anchor);
    expect(f.pane.scrollTop).toBe(320);
    f.rows[4].height = 500;
    centerChatMessage(f.pane as unknown as HTMLElement, f.rows[4] as unknown as HTMLElement);
    expect(f.pane.scrollTop).toBe(500);
  });
});
