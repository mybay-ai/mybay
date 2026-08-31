import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createChatAutoFollow } from "./chatAutoFollow";

export function useChatAutoFollow(options: {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  bottomAnchorRef: RefObject<HTMLDivElement | null>;
  forceScrollRef: RefObject<boolean>;
  contextKey: string;
  startFollowing: boolean;
  contentRevision: unknown;
  layoutRevision?: unknown;
}) {
  const { scrollContainerRef, bottomAnchorRef, forceScrollRef, contextKey, startFollowing, contentRevision, layoutRevision } = options;
  const [isFollowing, setFollowing] = useState(startFollowing);
  const controller = useRef<ReturnType<typeof createChatAutoFollow> | null>(null);
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    forceScrollRef.current = false;
    setFollowing(startFollowing);
    const current = createChatAutoFollow(container, {
      initiallyFollowing: startFollowing,
      onFollowingChange: setFollowing,
      onPause: () => { forceScrollRef.current = false; },
      runtime: { requestFrame: callback => window.requestAnimationFrame(callback), cancelFrame: id => window.cancelAnimationFrame(id), now: () => Date.now(), pointerTarget: window },
    });
    controller.current = current;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(current.update);
    observer?.observe(container);
    const content = bottomAnchorRef.current?.parentElement;
    if (content) observer?.observe(content);
    current.update();
    return () => { observer?.disconnect(); current.dispose(); controller.current = null; };
  }, [contextKey, startFollowing, scrollContainerRef, bottomAnchorRef, forceScrollRef]);

  useLayoutEffect(() => {
    if (forceScrollRef.current) {
      forceScrollRef.current = false;
      controller.current?.follow();
    } else controller.current?.update();
  }, [contentRevision, layoutRevision, forceScrollRef]);

  const pause = useCallback(() => controller.current?.pause(), []);
  const jumpToLatest = useCallback(() => controller.current?.follow(), []);
  const prepareForPrepend = useCallback(() => controller.current?.prepareForPrepend(), []);
  const revealMessage = useCallback((message: HTMLElement) => controller.current?.reveal(message), []);
  return { isFollowing, pause, jumpToLatest, prepareForPrepend, revealMessage };
}
