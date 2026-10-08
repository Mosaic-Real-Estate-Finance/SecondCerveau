import { useEffect, useReducer, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

// Long enough to cover --sheet-dur.
const CLOSE_MS = 520;
// Pulled down further than this, or flicked faster, the sheet lets go.
const DISMISS_PX = 120;
const DISMISS_SPEED = 0.5; // px per ms
// The top of the sheet is its handle, as on iOS: the grabber and the header.
const HANDLE_PX = 64;

// A sheet in the manner of UISheetPresentationController: it rises from the
// bottom with its content fully drawn, stops at three quarters of the screen
// at most, and the page behind it blurs. It is never faded: the sheet itself
// slides over the content as it opens and closes. Pulling it down from its
// top, tapping the blurred page or pressing Escape closes it.
//
// Rendered into <body>: every page carries a transform for its own slide,
// and a transformed ancestor would clip a fixed child to its box.
export function Sheet({
  open,
  onClose,
  label,
  full = false,
  level = 0,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  /** Always three quarters of the screen, for a form with its own scroller. */
  full?: boolean;
  /** A sheet opened from a sheet sits above it. */
  level?: number;
  children: ReactNode;
}) {
  // The caller may unmount its content as soon as it closes the sheet;
  // holding the last content keeps it drawn while the sheet slides away.
  const held = useRef<ReactNode>(null);
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  if (open) held.current = children;
  useEffect(() => {
    if (open || held.current === null) return;
    const timer = window.setTimeout(() => {
      held.current = null;
      redraw();
    }, CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const sheet = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; y: number; t: number; dy: number } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const node = sheet.current;
    if (!node || !open) return;
    const fromTop = event.clientY - node.getBoundingClientRect().top;
    if (fromTop > HANDLE_PX) return;
    if ((event.target as HTMLElement).closest("button, input, textarea, select, a, label")) return;
    drag.current = { id: event.pointerId, y: event.clientY, t: event.timeStamp, dy: 0 };
    node.setPointerCapture(event.pointerId);
    node.classList.add("is-dragging");
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    const raw = event.clientY - state.y;
    // Upwards it resists, as a sheet at its largest detent does.
    const dy = raw > 0 ? raw : raw / 6;
    state.dy = dy;
    sheet.current?.style.setProperty("--sheet-drag", `${dy}px`);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    drag.current = null;
    const node = sheet.current;
    node?.classList.remove("is-dragging");
    node?.style.removeProperty("--sheet-drag");
    const speed = state.dy / Math.max(1, event.timeStamp - state.t);
    if (state.dy > DISMISS_PX || speed > DISMISS_SPEED) onClose();
  };

  return createPortal(
    <div
      className="sheet-layer"
      data-open={open}
      inert={!open}
      style={{ zIndex: 30 + level * 2 }}
    >
      <div className="sheet-scrim" aria-hidden onClick={onClose} />
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn("sheet", full && "is-full")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="sheet-grabber" aria-hidden />
        <div className="sheet-body">{open ? children : held.current}</div>
      </div>
    </div>,
    document.body,
  );
}
