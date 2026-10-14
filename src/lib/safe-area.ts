import { isIOS, isStandalone } from "@/lib/standalone";

// --safe-top is env(safe-area-inset-top), which every layout pads by. An app
// installed on an iPhone is meant to sit under an opaque status bar
// (status-bar-style "default", index.html): the page starts below the bar
// and the inset is zero. But iOS sometimes lays the page out under the bar
// and still reports zero — on the very first launch after the install
// especially — and the settings and the bell then sit under the clock and
// the battery.
//
// The page cannot see where the bar is; it can see how much shorter it is
// than the screen. An earlier rule read « shorter at all » as « the bar is
// reserved », and a page under the bar but a little short for another
// reason (the home indicator, a value not yet settled) was left under it.
// The rule is now the other way round: the page is taken to be under the
// bar unless the gap is exactly a status bar's height — the one layout in
// which iOS really did reserve it. Wrong, this costs a few pixels too many
// at the top, never buttons under the battery.
//
// Android reports the inset correctly, and a browser tab keeps its own bar
// above the page, so both are left alone.

// Portrait status bar heights by screen height (points). The Dynamic Island
// models differ among themselves; the table errs to the taller.
function statusBar(screenHeight: number): number {
  if (screenHeight >= 874) return 62; // 16 Pro, 16 Pro Max, 17
  if (screenHeight >= 852) return 59; // 14 Pro, 15, 16, 15 Pro Max (932)
  if (screenHeight >= 812) return 50; // notch: X to 14 Plus, 16e (47 to 50)
  return 20; // home button
}

function reportedInset(): number {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;top:0;height:env(safe-area-inset-top);visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  const inset = probe.offsetHeight;
  probe.remove();
  return inset;
}

// ---- What was measured, for a launch that went wrong ------------------------
// The first launch cannot be watched from a computer. Its measurements are
// kept, so that Settings can show them (tap the title five times).

export type SafeAreaSample = {
  at: number; // ms since launch
  inner: number;
  screen: number;
  viewport: number;
  reported: number;
  bar: number;
  applied: number;
};

const LOG_KEY = "mosaic-safe-area";
const launchedAt = performance.now();
let samples: SafeAreaSample[] = [];

function remember(sample: SafeAreaSample) {
  samples = [...samples, sample].slice(-12);
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify({ launch: new Date().toISOString(), samples }));
  } catch {
    // Storage refused: only the diagnosis is lost.
  }
}

/** The current launch's measurements, or the last one's. */
export function safeAreaLog(): { launch: string; samples: SafeAreaSample[] } | null {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) ?? "null");
  } catch {
    return null;
  }
}

function apply() {
  const root = document.documentElement.style;
  root.removeProperty("--safe-top");
  const portrait = window.innerHeight >= window.innerWidth;
  const bar = statusBar(Math.max(screen.height, screen.width));
  const reported = reportedInset();
  const gap = Math.max(screen.height, screen.width) - window.innerHeight;
  // Reserved: the page is shorter than the screen by about a status bar —
  // the models within one height class differ by a few points. A gap of a
  // home indicator (34) or of nothing is not that.
  const reserved = gap >= bar - 12 && gap <= bar + 6;
  const applied = portrait && !reserved && reported < bar ? bar : 0;
  if (applied) root.setProperty("--safe-top", `max(env(safe-area-inset-top), ${applied}px)`);
  remember({
    at: Math.round(performance.now() - launchedAt),
    inner: window.innerHeight,
    screen: Math.max(screen.height, screen.width),
    viewport: Math.round(window.visualViewport?.height ?? 0),
    reported,
    bar,
    applied,
  });
}

// Evaluated whenever the layout may have changed, not once: at launch iOS
// settles the page and the inset over the first moments.
export function guardSafeTop() {
  if (!isIOS() || !isStandalone()) return;
  let frame = 0;
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(apply);
  };
  apply();
  for (const ms of [100, 400, 1000, 2500]) setTimeout(schedule, ms);
  window.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", () => setTimeout(schedule, 300));
  window.addEventListener("pageshow", schedule);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && schedule());
}
