import { describe, expect, it } from 'vitest';
import { positionComposerPopover } from './composerPopoverPosition';

describe('composer popover placement', () => {
  it.each([320, 375, 390, 430, 768, 1280])('keeps a bottom-anchored menu within a %ipx viewport', width => {
    const result = positionComposerPopover({ left: width - 60, top: 760, bottom: 800 }, { left: 0, top: 0, width, height: 844 }, 350);
    expect(result.left).toBeGreaterThanOrEqual(12);
    expect(result.left + result.width).toBeLessThanOrEqual(width - 12);
    expect(result.top).toBe(402);
    expect(result.top + 350).toBeLessThan(760);
  });
  it('opens below when there is not enough room above', () => {
    const result = positionComposerPopover({ left: 20, top: 30, bottom: 70 }, { left: 0, top: 0, width: 390, height: 844 }, 350);
    expect(result.top).toBe(78);
    expect(result.maxHeight).toBe(420);
  });
  it('uses the visual viewport offset and bounds when a keyboard or zoom is active', () => {
    const result = positionComposerPopover({ left: 40, top: 420, bottom: 460 }, { left: 10, top: 120, width: 320, height: 360 }, 350);
    expect(result.top).toBe(132);
    expect(result.maxHeight).toBe(280);
    expect(result.left).toBe(22);
    expect(result.left + result.width).toBe(318);
  });
  it('clamps a trigger outside the visible viewport and allows scrolling', () => {
    const result = positionComposerPopover({ left: 400, top: 740, bottom: 780 }, { left: 0, top: 0, width: 320, height: 300 }, 350);
    expect(result.left).toBe(12);
    expect(result.top).toBeGreaterThanOrEqual(12);
    expect(result.top + result.maxHeight).toBeLessThanOrEqual(288);
    expect(result.maxHeight).toBeLessThan(350);
  });
});
