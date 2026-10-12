import { useEffect, useLayoutEffect, useReducer, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

// Long enough to cover --sheet-dur.
const CLOSE_MS = 520;
export const SHEET_CLOSE_MS = CLOSE_MS;
// Pulled down further than this, or flicked faster, the sheet lets go.
const DISMISS_PX = 120;
const DISMISS_SPEED = 0.5; // px per ms
// The top of the sheet is its handle, as on iOS: the grabber and the header.
const HANDLE_PX = 64;
// The bottom padding of .sheet-body, below the content.
const BODY_PAD = 16;

// A sheet in the manner of UISheetPresentationController: it rises from the
// bottom with its content fully drawn, exactly as tall as that content — up
// to the large detent, never cut at an arbitrary fraction of the screen — and
// the page behind it blurs. It is never faded: the sheet itself
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
  /** The large detent: nearly the whole screen, for a form with its own scroller. */
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

  // Detents, as on iOS: the sheet is always as tall as the large detent and
  // is only ever moved, never resized. A smaller detent is the same sheet
  // pushed down until its content shows and no more. It is measured on every
  // opening and every resize, against the screen it is on: a short window
  // gets a taller sheet, so the whole content is always in view and nothing
  // scrolls inside it. Only content taller than the large detent itself —
  // more than a screen — can scroll, as it must. Growing to the large detent or back — the settings
  // opening their list of excluded contacts — is then one transform on the
  // compositor, the same motion as the opening, with no layout per frame.
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = sheet.current;
    const inner = content.current;
    if (!node || !inner) return;
    const place = () => {
      if (full) {
        node.style.setProperty("--sheet-offset", "0px");
        node.style.removeProperty("--sheet-visible");
        return;
      }
      const top = node.getBoundingClientRect().top;
      const bottomPad = parseFloat(getComputedStyle(node).paddingBottom) || 0;
      const natural = inner.getBoundingClientRect().bottom - top + BODY_PAD + bottomPad;
      const visible = Math.min(natural, node.offsetHeight);
      node.style.setProperty("--sheet-visible", `${visible}px`);
      node.style.setProperty("--sheet-offset", `${Math.max(0, node.offsetHeight - visible)}px`);
    };
    place();
    // The content changes height on its own: a list arriving, a row removed.
    const observer = new ResizeObserver(place);
    observer.observe(inner);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [full, open]);

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
        <div className="sheet-body">
          <div ref={content} className="sheet-content">
            {open ? children : held.current}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// The pages of one sheet, side by side: a row that opens a second page — the
// settings' excluded contacts, the QR code — slides it in from the right
// while the first leaves to the left, and back the other way. The same motion
// and timing as the app's pages (--page-slide-*), so a sheet's own navigation
// reads as the rest of the app's.
//
// Both pages share one grid cell while they cross, so the sheet measures the
// taller of the two and never jumps mid-slide; the outgoing one is dropped
// once its slide is over, and the sheet settles on the new page's height.
const PAGE_MS = 480;

export function SheetPages({ id, depth, children }: { id: string; depth: number; children: ReactNode }) {
  const current = useRef({ id, depth, children });
  const leaving = useRef<{ id: string; children: ReactNode; forward: boolean } | null>(null);
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  if (current.current.id !== id) {
    leaving.current = { id: current.current.id, children: current.current.children, forward: depth > current.current.depth };
  }
  current.current = { id, depth, children };
  const exit = leaving.current;

  useEffect(() => {
    if (!leaving.current) return;
    const timer = window.setTimeout(() => {
      leaving.current = null;
      redraw();
    }, PAGE_MS);
    return () => window.clearTimeout(timer);
  }, [id]);

  return (
    <div className="sheet-pages">
      {exit && (
        <div key={exit.id} className="sheet-page" data-motion={exit.forward ? "out-left" : "out-right"} inert aria-hidden>
          {exit.children}
        </div>
      )}
      <div key={id} className="sheet-page" data-motion={exit ? (exit.forward ? "in-right" : "in-left") : undefined}>
        {children}
      </div>
    </div>
  );
}
