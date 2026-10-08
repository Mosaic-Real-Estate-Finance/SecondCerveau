import { useEffect, useReducer, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

// Long enough to cover --panel-close-dur.
const CLOSE_MS = 360;

// transitions.dev panel reveal, as a sheet over the whole screen: it rises a
// short way, fades and un-blurs on one clock. Rendered into <body>, because
// every page carries a transform for its own slide and a transformed
// ancestor would clip a fixed child to its box.
export function PanelSheet({
  open,
  children,
  className,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) {
  // The caller may unmount its content as soon as it closes the sheet;
  // holding the last content for the length of the close keeps the sheet
  // from fading out empty.
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

  return createPortal(
    <div
      className={cn("panel-sheet t-panel-slide", className)}
      data-open={open}
      inert={!open}
      // A morph button inside the sheet (a company created from the contact
      // form) is a fixed box placed from its anchor's rectangle, and the
      // anchor was still travelling with the sheet when it was measured. A
      // resize is what makes it measure again.
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === "transform") {
          window.dispatchEvent(new Event("resize"));
        }
      }}
    >
      {open ? children : held.current}
    </div>,
    document.body,
  );
}
