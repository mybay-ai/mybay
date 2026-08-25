export type MobileWorkspaceFrame = {
  top: number;
  bottom: number;
  keyboardOpen: boolean;
};

type MobileWorkspaceFrameInput = {
  innerHeight: number;
  viewportHeight: number;
  viewportOffsetTop: number;
  headerOffset?: number;
  keyboardThreshold?: number;
};

export function computeMobileWorkspaceFrame({
  innerHeight,
  viewportHeight,
  viewportOffsetTop,
  headerOffset = 48,
  keyboardThreshold = 120
}: MobileWorkspaceFrameInput): MobileWorkspaceFrame {
  const safeInnerHeight = Math.max(0, innerHeight);
  const safeViewportHeight = Math.max(0, viewportHeight);
  const safeViewportOffsetTop = Math.max(0, viewportOffsetTop);
  const bottom = Math.max(
    0,
    Math.round(safeInnerHeight - safeViewportHeight - safeViewportOffsetTop)
  );
  const viewportReduction = Math.max(0, safeInnerHeight - safeViewportHeight);

  return {
    top: Math.max(0, Math.round(headerOffset)),
    bottom,
    keyboardOpen: viewportReduction >= keyboardThreshold
  };
}
