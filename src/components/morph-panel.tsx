import { useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SCRIM_TINT, useCanvasTint } from "@/lib/canvas-tint";
import { cn } from "@/lib/utils";

// Long enough to cover --morph-close-dur; the content is only held on screen
// so the panel does not collapse empty.
const CLOSE_MS = 260;

// transitions.dev 20, plus to menu morph, grown out of its button.
// The snippet animates width, height and radius between two fixed sizes; a
// panel that grows to the screen has no fixed size, and `auto` does not
// animate. So the panel is positioned fixed and its four insets are animated
// from the anchor's rectangle to its target. `overflow: hidden` is what hides
// everything behind it while it travels.
//
// The panel is rendered into <body> and only its anchor stays in the layout.
// Every ancestor that could hold it carries a transform — the page for the
// slide transition, the outer panel's menu for its own entrance — and a
// transformed ancestor becomes the containing block of its fixed children
// *and* clips them to its box. Measured from <body>, the rectangle the
// anchor reports is the one the panel is laid out in.

export function MorphPanel({
  open,
  onOpen,
  onClose,
  label,
  icon,
  nested,
  children,
  className,
}: {
  open: boolean;
  onOpen: () => void;
  /** Dismiss from outside the panel; only used when it is a card. */
  onClose?: () => void;
  label: string;
  icon: ReactNode;
  /** Opened from inside another panel: a card over it, not a second page. */
  nested?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // Turned on by the first successful measurement, never before: with no
  // insets the panel's four sides default to zero, which is the whole
  // screen. Shown a frame too early it is a white sheet over the app with
  // the button stranded in its top left corner.
  const [placed, setPlaced] = useState(false);
  // The panel lives in <body>, so the page it belongs to cannot hide it the
  // way it hides everything else on itself. It reads the page's own inert
  // flag instead: the contact screen's button has no business floating over
  // the home screen.
  const [onDuty, setOnDuty] = useState(true);
  // The children of an open panel are a whole form. Laying it out costs a
  // frame, and that frame used to be the first of the animation, which is
  // what made the opening look like it stumbled. The content is committed
  // first and the panel is only told to grow once the browser has painted.
  const [grown, setGrown] = useState(false);

  // The closed panel is a fixed box that has to sit exactly on its anchor,
  // and the row it lives in moves whenever what is above it changes — the
  // note card appearing on the contact screen pushed it up by its whole
  // height and left the button stranded over the card. So it is measured
  // again after every render, on every scroll and on every resize.
  //
  // Always through a frame, never straight away. Reading a rectangle inside
  // a layout effect makes the browser lay the page out there and then; with
  // two of these panels re-rendering while a page slides, that was the most
  // expensive thing on the main thread. By the time a frame runs the layout
  // is done and the same read is nearly free.
  const queued = useRef(0);
  const place = () => {
    if (queued.current) return;
    queued.current = requestAnimationFrame(() => {
      queued.current = 0;
      const node = anchor.current;
      const box = panel.current;
      if (!node || !box) return;
      const rect = node.getBoundingClientRect();
      box.style.setProperty("--morph-top", `${rect.top}px`);
      box.style.setProperty("--morph-left", `${rect.left}px`);
      box.style.setProperty("--morph-right", `${window.innerWidth - rect.right}px`);
      box.style.setProperty("--morph-bottom", `${window.innerHeight - rect.bottom}px`);
      setPlaced(true);
      setOnDuty(!node.closest("[inert]"));
    });
  };

  useLayoutEffect(place);
  useEffect(
    () => () => {
      // Clearing the handle as well as the frame: leaving it set would make
      // the guard above think a measurement is still on its way and refuse
      // every one after it, which is how the panel ended up never placed.
      cancelAnimationFrame(queued.current);
      queued.current = 0;
    },
    [],
  );

  useLayoutEffect(() => {
    // Layout changes this component does not re-render for: a font landing,
    // an image sizing, the keyboard resizing the page.
    const observer = new ResizeObserver(place);
    if (anchor.current) observer.observe(anchor.current);
    const page = anchor.current?.closest(".t-page");
    if (page) observer.observe(page);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A fixed box cannot be clipped by the overflow of the list or the form it
  // belongs to, so the closed button went on showing over whatever was below
  // once its row had scrolled past the end of the scroller. It is hidden as
  // soon as its anchor is no longer wholly inside it.
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const node = anchor.current;
    const root = node?.closest<HTMLElement>(".morph-scroll, .t-page");
    if (!node || !root) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.intersectionRatio > 0.99), {
      root,
      threshold: [0, 0.99, 1],
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return setGrown(false);
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setGrown(true)));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // The caller unmounts its form as soon as it closes the panel. Holding the
  // last content for the length of the close keeps the sheet from collapsing
  // as an empty white box.
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

  // The scrim cannot be painted under the floating browser bar, so the
  // canvas behind it is painted instead (see canvas-tint.ts).
  useCanvasTint(nested && grown && onDuty ? SCRIM_TINT : null);

  // While open, what is behind must not scroll. The scroller here is the
  // form or the page, never the document, so locking the body would do
  // nothing at all.
  useEffect(() => {
    if (!open) return;
    const behind = anchor.current?.closest<HTMLElement>(".morph-scroll, .t-page") ?? document.body;
    const previous = behind.style.overflow;
    behind.style.overflow = "hidden";
    return () => {
      behind.style.overflow = previous;
    };
  }, [open]);

  return (
    <div ref={anchor} className={cn("h-12 w-12 shrink-0", className)}>
      {createPortal(
        <>
          {nested && (
            <div
              className="morph-scrim"
              data-open={grown && onDuty}
              aria-hidden
              onClick={onClose}
            />
          )}
          <div
            ref={panel}
            className={cn(
              "morph-panel t-morph",
              nested && "is-nested",
              (!placed || !onDuty || (!open && !inView)) && "is-measuring",
            )}
            data-open={grown}
          >
            <div className="t-morph-menu" aria-hidden={!open}>
              {held.current}
            </div>
            <button
              type="button"
              className="t-morph-plus"
              aria-expanded={open}
              aria-label={label}
              onClick={onOpen}
              tabIndex={open ? -1 : 0}
            >
              {icon}
            </button>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
