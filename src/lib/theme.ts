import { useSyncExternalStore } from "react";

// The colours live in CSS (src/styles/index.css), light and dark. Most of the
// app reads them there through Tailwind and var(); this is for the few places
// that need them in JavaScript — a canvas glow, a colour handed to an iframe —
// and must follow the system when it turns.

const query = typeof window === "undefined" ? null : window.matchMedia("(prefers-color-scheme: dark)");

const subscribe = (onChange: () => void) => {
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
};

/** "dark" or "light", live: the component renders again when the system turns. */
export const useColorScheme = () =>
  useSyncExternalStore(
    subscribe,
    () => (query?.matches ? "dark" : "light"),
    () => "light" as const,
  );

/** A custom property of the page, as the current theme resolves it. */
export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
