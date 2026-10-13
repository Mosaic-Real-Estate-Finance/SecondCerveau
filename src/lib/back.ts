import { useEffect, useRef } from "react";
import { isIOS } from "@/lib/standalone";

// Android's back gesture and back button go back in the browser history. The
// app changes screen and opens its sheets without touching the history, so
// back used to leave the app from anywhere: from the contacts, from the
// notifications, from a sheet half filled in.
//
// Each layer that back should close — a page past the home screen, a sheet,
// a sheet's second page, the install guide — takes one history entry while it
// is open. Back pops the topmost layer, which closes as its own button would.
// A layer closed by its button gives its entry back, quietly.
//
// Not on iOS: an installed app has no back gesture there, and Safari's own
// swipe would play its page animation over the app's.

type Layer = { id: number; onBack: () => boolean | void };

const stack: Layer[] = [];
let next = 1;
// History moves this code made itself, not the user's back: let through once.
let ignored = 0;
let listening = false;

const enabled = () => typeof window !== "undefined" && !isIOS();

function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener("popstate", () => {
    if (ignored > 0) {
      ignored -= 1;
      return;
    }
    const layer = stack.pop();
    if (!layer) return;
    // A layer may refuse to close (a dictation under way): it keeps its place
    // and its entry.
    if (layer.onBack() === false) {
      stack.push(layer);
      history.pushState({ layer: layer.id }, "");
    }
  });
}

function open(onBack: () => boolean | void): number {
  listen();
  const layer = { id: next++, onBack };
  stack.push(layer);
  history.pushState({ layer: layer.id }, "");
  return layer.id;
}

function close(id: number) {
  const index = stack.findIndex((layer) => layer.id === id);
  if (index === -1) return;
  const top = index === stack.length - 1;
  stack.splice(index, 1);
  // Only the top entry can be taken back without disturbing the others; one
  // further down stays in the history and a later back passes over it.
  if (top) {
    ignored += 1;
    history.back();
  }
}

/**
 * While `open`, back calls `onBack` instead of leaving the app. `onBack`
 * returns false to stay open. The latest `onBack` is always the one called.
 */
export function useBackLayer(open_: boolean, onBack: () => boolean | void) {
  const handler = useRef(onBack);
  handler.current = onBack;
  useEffect(() => {
    if (!open_ || !enabled()) return;
    const id = open(() => handler.current());
    return () => close(id);
  }, [open_]);
}
