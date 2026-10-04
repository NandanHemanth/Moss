// One small popover used everywhere (tile details, settings, system status).
// Rendered in a portal with fixed positioning so no scrolling column can clip it; it is kept inside the
// viewport, and closes on Escape or a click outside.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

type Side = "bottom" | "top";
type Align = "start" | "end";

const GAP = 8;
const EDGE = 10;

export function Popover({
  anchor,
  open,
  onClose,
  label,
  side = "bottom",
  align = "start",
  width = 320,
  className = "",
  children,
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  /** Accessible name of the dialog. */
  label: string;
  side?: Side;
  align?: Align;
  width?: number;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const el = ref.current;
      if (!a || !el) return;
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const w = el.offsetWidth;
      const h = el.scrollHeight;
      let left = align === "end" ? a.right - w : a.left;
      left = Math.max(EDGE, Math.min(left, vw - w - EDGE));
      const below = vh - a.bottom - GAP - EDGE;
      const above = a.top - GAP - EDGE;
      // Prefer the requested side; flip when the other one has clearly more room.
      const useTop = side === "top" ? above >= Math.min(h, 160) || above > below : below < Math.min(h, 160) && above > below;
      const maxHeight = Math.max(120, useTop ? above : below);
      const top = useTop ? Math.max(EDGE, a.top - GAP - Math.min(h, maxHeight)) : a.bottom + GAP;
      setPos((prev) => (prev && prev.left === left && prev.top === top && prev.maxHeight === maxHeight ? prev : { left, top, maxHeight }));
    };
    place();
    // Content that arrives later (the brief) changes the height: place again.
    const ro = typeof ResizeObserver !== "undefined" && ref.current ? new ResizeObserver(place) : null;
    if (ro && ref.current) ro.observe(ref.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, side, align]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closeRef.current();
      anchor.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      closeRef.current();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [open, anchor]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className={`pop ${className}`}
      role="dialog"
      aria-label={label}
      data-testid="popover"
      style={{
        width: `min(${width}px, calc(100vw - ${EDGE * 2}px))`,
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        maxHeight: pos?.maxHeight,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
