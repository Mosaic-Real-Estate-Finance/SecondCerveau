import { useEffect } from "react";

// The strip of colour under a full-screen overlay, on iOS 26.
//
// Safari 26 draws its browser controls as a bar floating over the page, and
// it will not render `position: fixed` content below them — no CSS length
// reaches there, `lvh` and `dvh` both stop at the same line, and an overlay
// with `inset: 0` ends on it. What shows underneath is the canvas: the
// background the browser propagates from the root element to paint
// everything outside the page box, the same colour as the rubber band of an
// overscroll.
//
// So the overlay does not try to cover that region — it cannot. The canvas
// is repainted instead, in the colour the overlay itself has, and the seam
// has nothing left to separate.
//
// Colours are the overlay composited over white, because that is what the
// canvas shows: an overlay at 32% of #020342 is #AEAFC2, not #020342.

const stack: string[] = [];
let original: string | null = null;

function apply() {
  const root = document.documentElement;
  if (original === null) original = root.style.background;
  const top = stack[stack.length - 1];
  if (top) root.style.background = top;
  else {
    root.style.background = original;
    original = null;
  }
}

/** Repaints the canvas while the component is mounted, restoring it after. */
export function useCanvasTint(colour: string | null) {
  useEffect(() => {
    if (!colour) return;
    stack.push(colour);
    apply();
    return () => {
      const at = stack.lastIndexOf(colour);
      if (at >= 0) stack.splice(at, 1);
      apply();
    };
  }, [colour]);
}

// Only an overlay that reaches the bottom edge of the screen needs this.
// The bottom sheets are white and meet a white canvas already; the card over
// the contact form does not — its scrim is what the app paints down there.
/** #020342 at 32% over white: the scrim behind the company card. */
export const SCRIM_TINT = "#aeafc2";
