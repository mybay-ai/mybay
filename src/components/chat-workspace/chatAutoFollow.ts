export const CHAT_BOTTOM_THRESHOLD = 64;

type Metrics = Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">;
export function isNearChatBottom(element: Metrics) {
  return element.scrollHeight - element.clientHeight - element.scrollTop <= CHAT_BOTTOM_THRESHOLD;
}

export function captureChatReadingAnchor(container: HTMLElement) {
  const top = container.getBoundingClientRect().top + container.clientTop;
  const row = Array.from(container.querySelectorAll<HTMLElement>("[data-chat-message-id]")).find(element => (
    element.getBoundingClientRect().bottom > top && element.getBoundingClientRect().top < top + container.clientHeight
  ));
  return { row, offset: row ? row.getBoundingClientRect().top - top : 0, scrollTop: container.scrollTop };
}

export function restoreChatReadingAnchor(container: HTMLElement, anchor: ReturnType<typeof captureChatReadingAnchor>) {
  if (anchor.row && container.contains(anchor.row)) {
    const top = container.getBoundingClientRect().top + container.clientTop;
    container.scrollTop += anchor.row.getBoundingClientRect().top - top - anchor.offset;
  } else {
    container.scrollTop = anchor.scrollTop;
  }
}

export function centerChatMessage(container: HTMLElement, message: HTMLElement) {
  const top = container.getBoundingClientRect().top + container.clientTop;
  const rect = message.getBoundingClientRect();
  // Scroll this pane only, never the page or a nested ancestor.
  container.scrollTop += rect.top - top - Math.max(0, (container.clientHeight - rect.height) / 2);
}

type ScrollRuntime = {
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
  now: () => number;
  pointerTarget: Pick<Window, "addEventListener" | "removeEventListener">;
};

// Independent of React so event ordering, deferred frames and disposal can be tested.
export function createChatAutoFollow(container: HTMLElement, options: {
  initiallyFollowing: boolean;
  onFollowingChange: (following: boolean) => void;
  onPause: () => void;
  runtime: ScrollRuntime;
}) {
  const { runtime } = options;
  let following = options.initiallyFollowing;
  let disposed = false;
  let frame: number | null = null;
  let pointerActive = false;
  let intentUntil = 0;
  let touchY: number | null = null;
  let lastTop = container.scrollTop;
  let anchor = captureChatReadingAnchor(container);

  const cancelFrame = () => {
    if (frame !== null) runtime.cancelFrame(frame);
    frame = null;
  };
  const setFollowing = (next: boolean) => {
    if (following === next || disposed) return;
    following = next;
    options.onFollowingChange(next);
  };
  const remember = () => { anchor = captureChatReadingAnchor(container); lastTop = container.scrollTop; };
  const pause = () => {
    cancelFrame();
    options.onPause();
    setFollowing(false);
    remember();
  };
  const update = () => {
    if (disposed || pointerActive || frame !== null) return;
    frame = runtime.requestFrame(() => {
      frame = null;
      if (disposed || pointerActive) return;
      if (following) container.scrollTop = container.scrollHeight;
      else restoreChatReadingAnchor(container, anchor);
      remember();
    });
  };
  const follow = () => {
    if (disposed) return;
    pointerActive = false;
    intentUntil = 0;
    setFollowing(true);
    update();
  };
  const markIntent = () => { intentUntil = runtime.now() + 500; };
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || !event.deltaY) return;
    markIntent();
    if (event.deltaY < 0 && container.scrollHeight > container.clientHeight + 1) pause();
  };
  const onPointerDown = () => { pointerActive = true; markIntent(); cancelFrame(); remember(); };
  const onPointerUp = () => {
    if (!pointerActive) return;
    pointerActive = false;
    remember();
    update();
  };
  const onTouchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY ?? null; markIntent(); };
  const onTouchMove = (event: TouchEvent) => {
    const nextY = event.touches[0]?.clientY;
    if (nextY == null) return;
    markIntent();
    if (touchY !== null && nextY > touchY && container.scrollHeight > container.clientHeight + 1) pause();
    touchY = nextY;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (event.defaultPrevented || target?.closest?.("input,textarea,select,button,a,[contenteditable]:not([contenteditable=false]),[role=textbox]")) return;
    if (["ArrowUp", "PageUp", "Home"].includes(event.key) || (event.key === " " && event.shiftKey)) {
      markIntent(); pause();
    } else if (event.key === "End") {
      event.preventDefault(); follow();
    } else if (["ArrowDown", "PageDown", " "].includes(event.key)) markIntent();
  };
  const onScroll = () => {
    const delta = container.scrollTop - lastTop;
    if (Math.abs(delta) < 0.5) return;
    if (pointerActive || runtime.now() < intentUntil) {
      if (delta < 0 || !isNearChatBottom(container)) pause();
      else if (delta > 0) setFollowing(true);
    }
    remember();
    if (following) update();
  };

  container.addEventListener("wheel", onWheel, { passive: true });
  container.addEventListener("pointerdown", onPointerDown, { passive: true });
  container.addEventListener("touchstart", onTouchStart, { passive: true });
  container.addEventListener("touchmove", onTouchMove, { passive: true });
  container.addEventListener("keydown", onKeyDown);
  container.addEventListener("scroll", onScroll, { passive: true });
  runtime.pointerTarget.addEventListener("pointerup", onPointerUp);
  runtime.pointerTarget.addEventListener("pointercancel", onPointerUp);
  return {
    update, pause, follow,
    prepareForPrepend: () => { if (!following) remember(); },
    reveal: (message: HTMLElement) => { pause(); centerChatMessage(container, message); remember(); },
    isFollowing: () => following,
    dispose: () => {
      disposed = true;
      cancelFrame();
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("keydown", onKeyDown);
      container.removeEventListener("scroll", onScroll);
      runtime.pointerTarget.removeEventListener("pointerup", onPointerUp);
      runtime.pointerTarget.removeEventListener("pointercancel", onPointerUp);
    },
  };
}
