import { useSyncExternalStore } from "react";

// Light or dark. "auto" follows the phone; the other two pin one regardless.
// The first resolution happens in index.html, before the first paint, so an
// installed app never flashes white on a dark phone. This module takes over
// from there: the setting in Réglages, and the phone switching at sunset.
//
// The resolved theme lives on <html data-theme>, which the stylesheet keys
// on. The key and the colours below are repeated in index.html's script.

export type ThemePreference = "auto" | "light" | "dark";

const KEY = "mosaic-theme";
// The status bar and the browser chrome: the surface colour of each theme.
const BAR = { light: "#ffffff", dark: "#0b0c22" } as const;

const media = typeof window !== "undefined" ? window.matchMedia?.("(prefers-color-scheme: dark)") : undefined;
const listeners = new Set<() => void>();

function read(): ThemePreference {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "auto";
  } catch {
    // Storage blocked (private mode): follow the phone.
    return "auto";
  }
}

let preference = read();
let resolved: "light" | "dark" =
  typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light";

function apply() {
  const theme = preference === "auto" ? (media?.matches ? "dark" : "light") : preference;
  resolved = theme;
  document.documentElement.dataset.theme = theme;
  // One tag, rewritten, rather than the two media-bound tags of the static
  // page: a pinned theme has to win over the phone's.
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute("content", BAR[theme]);
    meta.removeAttribute("media");
  });
  listeners.forEach((listener) => listener());
}

media?.addEventListener("change", () => {
  if (preference === "auto") apply();
});

export function setThemePreference(next: ThemePreference) {
  preference = next;
  try {
    if (next === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // Applied for this session only.
  }
  apply();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** What the user chose in Réglages. */
export const useThemePreference = (): ThemePreference => useSyncExternalStore(subscribe, () => preference);

/** What is on screen, for what CSS cannot reach (the voice glow's canvas). */
export const useTheme = (): "light" | "dark" => useSyncExternalStore(subscribe, () => resolved);
