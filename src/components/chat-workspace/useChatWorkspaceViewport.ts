import { useEffect, useState, type RefObject } from "react";
import { CHAT_WORKSPACE_TABLET_BREAKPOINT } from "./chatWorkspaceResponsiveLayout";
import { computeMobileWorkspaceFrame, type MobileWorkspaceFrame } from "./mobileWorkspaceLayout";

type ViewportOptions = {
  workspaceRootRef: RefObject<HTMLDivElement | null>;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  shouldScrollToBottomRef: RefObject<boolean>;
  mobileOverlay: "history" | "workspace" | null;
  closeMobileOverlay: () => void;
};

export function useChatWorkspaceViewport(options: ViewportOptions): MobileWorkspaceFrame | null {
  const [mobileWorkspaceFrame, setMobileWorkspaceFrame] = useState<MobileWorkspaceFrame | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let frameId: number | null = null;
    const updateFrame = () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        if (!options.workspaceRootRef.current || window.innerWidth >= CHAT_WORKSPACE_TABLET_BREAKPOINT) {
          setMobileWorkspaceFrame(null);
          return;
        }
        const visualViewport = window.visualViewport;
        setMobileWorkspaceFrame(computeMobileWorkspaceFrame({
          innerHeight: window.innerHeight,
          viewportHeight: visualViewport?.height ?? window.innerHeight,
          viewportOffsetTop: visualViewport?.offsetTop ?? 0,
          headerOffset: 48,
        }));
        if (options.shouldScrollToBottomRef.current) {
          const container = options.scrollContainerRef.current;
          if (container) container.scrollTo({ top: container.scrollHeight, behavior: "auto" });
        }
      });
    };
    updateFrame();
    window.addEventListener("resize", updateFrame);
    window.addEventListener("orientationchange", updateFrame);
    window.visualViewport?.addEventListener("resize", updateFrame);
    window.visualViewport?.addEventListener("scroll", updateFrame);
    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updateFrame);
      window.removeEventListener("orientationchange", updateFrame);
      window.visualViewport?.removeEventListener("resize", updateFrame);
      window.visualViewport?.removeEventListener("scroll", updateFrame);
    };
  }, [options.scrollContainerRef, options.shouldScrollToBottomRef, options.workspaceRootRef]);

  useEffect(() => {
    if (!options.mobileOverlay) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") options.closeMobileOverlay();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [options.closeMobileOverlay, options.mobileOverlay]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const html = document.documentElement;
    const body = document.body;
    const previous = {
      htmlOverflow: html.style.overflow,
      htmlOverscroll: html.style.overscrollBehaviorY,
      htmlHeight: html.style.height,
      bodyOverflow: body.style.overflow,
      bodyOverscroll: body.style.overscrollBehaviorY,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyWidth: body.style.width,
      bodyHeight: body.style.height,
    };
    let lockedScrollY = 0;
    let lockApplied = false;
    const restore = () => {
      if (!lockApplied) return;
      html.style.overflow = previous.htmlOverflow;
      html.style.overscrollBehaviorY = previous.htmlOverscroll;
      html.style.height = previous.htmlHeight;
      body.style.overflow = previous.bodyOverflow;
      body.style.overscrollBehaviorY = previous.bodyOverscroll;
      body.style.position = previous.bodyPosition;
      body.style.top = previous.bodyTop;
      body.style.left = previous.bodyLeft;
      body.style.right = previous.bodyRight;
      body.style.width = previous.bodyWidth;
      body.style.height = previous.bodyHeight;
      window.scrollTo({ top: lockedScrollY, behavior: "auto" });
      lockApplied = false;
    };
    const apply = () => {
      if (window.innerWidth >= CHAT_WORKSPACE_TABLET_BREAKPOINT) return restore();
      if (!lockApplied) lockedScrollY = window.scrollY || window.pageYOffset || 0;
      html.style.overflow = "hidden";
      html.style.overscrollBehaviorY = "none";
      html.style.height = "100%";
      body.style.position = "fixed";
      body.style.top = `-${lockedScrollY}px`;
      body.style.left = "0";
      body.style.right = "0";
      body.style.width = "100%";
      body.style.height = "100%";
      body.style.overflow = "hidden";
      body.style.overscrollBehaviorY = "none";
      lockApplied = true;
    };
    apply();
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      restore();
    };
  }, []);

  return mobileWorkspaceFrame;
}
