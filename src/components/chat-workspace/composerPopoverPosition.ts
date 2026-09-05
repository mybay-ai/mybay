type AnchorRect = { left: number; right?: number; top: number; bottom: number };
type ViewportRect = { left: number; top: number; width: number; height: number };
type PopoverPositionOptions = { maxWidth?: number; maxHeight?: number; align?: 'start' | 'end' };

/** Keep the popover inside the visible viewport, including a raised soft keyboard. */
export function positionComposerPopover(anchor: AnchorRect, viewport: ViewportRect, contentHeight: number, options: PopoverPositionOptions = {}) {
  const margin = 12;
  const gap = 8;
  const width = Math.max(0, Math.min(options.maxWidth ?? 304, viewport.width - margin * 2));
  const leftEdge = viewport.left + margin;
  const rightEdge = viewport.left + viewport.width - margin;
  const topEdge = viewport.top + margin;
  const bottomEdge = viewport.top + viewport.height - margin;
  const above = Math.max(0, Math.min(anchor.top, bottomEdge) - gap - topEdge);
  const below = Math.max(0, bottomEdge - Math.max(anchor.bottom, topEdge) - gap);
  const placeAbove = above >= Math.min(contentHeight, 220) || above >= below;
  const maxHeight = Math.min(options.maxHeight ?? 420, placeAbove ? above : below);
  const height = Math.min(contentHeight, maxHeight);
  const idealTop = placeAbove ? anchor.top - gap - height : anchor.bottom + gap;
  const idealLeft = options.align === 'end' ? (anchor.right ?? anchor.left) - width : anchor.left;
  return {
    width,
    maxHeight,
    left: Math.max(leftEdge, Math.min(idealLeft, rightEdge - width)),
    top: Math.max(topEdge, Math.min(idealTop, bottomEdge - height)),
  };
}
