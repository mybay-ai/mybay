import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import "./ConversationTitle.css";

type ReadingState = { mode: "pointer" | "focus"; distance: number };

export function ConversationTitle({ title, children, disabled = false }: {
  title: string;
  children?: ReactNode;
  disabled?: boolean;
}) {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reading, setReading] = useState<ReadingState | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const tooltipId = useId();

  const clearTimers = () => {
    if (showTimer.current !== null) clearTimeout(showTimer.current);
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    showTimer.current = null;
    hideTimer.current = null;
  };
  const dismiss = () => {
    clearTimers();
    setReading(null);
  };
  const scheduleHide = () => {
    clearTimers();
    // Allow moving from the title into the full-title tooltip.
    hideTimer.current = setTimeout(() => setReading(null), 120);
  };

  useEffect(() => {
    setReading(null);
    const viewport = viewportRef.current;
    const text = textRef.current;
    const trigger = viewport?.closest<HTMLElement>("[data-conversation-title-trigger]");
    if (!viewport || !text || !trigger || disabled) return;

    const show = (mode: ReadingState["mode"]) => {
      const distance = Math.max(0, text.scrollWidth - viewport.clientWidth);
      const clipped = distance > 1 || text.scrollHeight > text.clientHeight + 1;
      if (clipped) setReading({ mode, distance });
    };
    const enter = (event: PointerEvent) => {
      // A narrow desktop panel still has a mouse: do not gate reading on viewport width.
      if (event.pointerType !== "mouse") return;
      clearTimers();
      showTimer.current = setTimeout(() => show("pointer"), 500);
    };
    const focus = (event: FocusEvent) => {
      if (event.target !== trigger) return;
      clearTimers();
      show("focus");
    };
    const leave = () => scheduleHide();
    const cancel = () => dismiss();
    trigger.addEventListener("pointerenter", enter);
    trigger.addEventListener("pointerleave", leave);
    trigger.addEventListener("focusin", focus);
    trigger.addEventListener("focusout", cancel);
    trigger.addEventListener("pointerdown", cancel);
    trigger.addEventListener("dragstart", cancel);
    return () => {
      clearTimers();
      trigger.removeEventListener("pointerenter", enter);
      trigger.removeEventListener("pointerleave", leave);
      trigger.removeEventListener("focusin", focus);
      trigger.removeEventListener("focusout", cancel);
      trigger.removeEventListener("pointerdown", cancel);
      trigger.removeEventListener("dragstart", cancel);
    };
  }, [title, disabled]);

  useLayoutEffect(() => {
    if (!reading || !viewportRef.current || !tooltipRef.current) return;
    // Anchor outside the whole row so the tooltip never covers its actions button.
    const anchor = (viewportRef.current.closest<HTMLElement>("[data-conversation-title-row]") || viewportRef.current.closest<HTMLElement>("[data-conversation-title-trigger]") || viewportRef.current).getBoundingClientRect();
    const tooltip = tooltipRef.current.getBoundingClientRect();
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - tooltip.width - margin);
    const left = anchor.right + tooltip.width + margin * 2 <= window.innerWidth
      ? anchor.right + margin
      : Math.min(Math.max(margin, anchor.left), maxLeft);
    const preferredTop = left > anchor.right ? anchor.top : anchor.bottom + margin;
    const top = preferredTop + tooltip.height + margin <= window.innerHeight
      ? preferredTop
      : Math.max(margin, anchor.top - tooltip.height - margin);
    setPosition({ left, top });
  }, [reading, title]);

  useEffect(() => {
    if (!reading) return;
    const close = () => dismiss();
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", escape);
    };
  }, [reading]);

  return (
    <>
      <span
        ref={viewportRef}
        className="conversation-title"
        data-reading={reading?.mode}
        style={reading ? {
          "--conversation-title-offset": `${-reading.distance}px`,
          "--conversation-title-duration": `${Math.max(1, reading.distance / 28)}s`
        } as CSSProperties : undefined}
      >
        <span ref={textRef} className="conversation-title-text">{children ?? title}</span>
      </span>
      {reading && !disabled && typeof document !== "undefined" && createPortal(
        <span
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          className="fixed z-[80] block w-max max-w-[min(320px,calc(100vw-16px))] whitespace-normal break-words rounded-lg border border-outline-strong bg-surface px-3 py-2 text-[13px] leading-relaxed text-content shadow-lg [overflow-wrap:anywhere]"
          style={position}
          onPointerEnter={clearTimers}
          onPointerLeave={scheduleHide}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >{title}</span>,
        document.body
      )}
    </>
  );
}
