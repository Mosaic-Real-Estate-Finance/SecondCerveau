import { isIOS, isStandalone } from "@/lib/standalone";

// --safe-top is env(safe-area-inset-top), which every layout pads by. An
// installed app can be laid out under the status bar while the inset still
// reads zero: the bell and the settings then sat under the clock and the
// battery. When the page covers the whole screen and the inset says nothing,
// the status bar's height is supplied instead.
//
// The check is not a one-off. On a cold launch — the first one after signing
// in above all — iOS lays the page out in steps: the first measure can find a
// page shorter than the screen, or an inset not computed yet, and later ones
// the real thing. So it runs again on every change of size or orientation, on
// coming back to the front, and through the first seconds; each run starts
// from the reported value, so the fix is dropped as soon as the system
// reports the inset itself.
//
// Android reports the inset correctly and keeps an opaque status bar above an
// installed app: the page is then shorter than the screen and nothing is
// touched. Only the faulty case — a page as tall as the screen, an inset of
// zero — gets a height, as on iOS. A browser tab keeps its own bars and is
// left alone.

// The portrait status bar of an iPhone, by screen height in points. Where two
// models share a height, the taller bar: a few points too many leave a little
// air, too few put the buttons under the clock.
const IOS_STATUS_BAR: Record<number, number> = {
  956: 62, // 16 Pro Max
  932: 59, // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  926: 47, // 12 Pro Max, 13 Pro Max, 14 Plus
  896: 48, // XR, 11 (XS Max, 11 Pro Max: 44)
  874: 62, // 16 Pro
  852: 59, // 14 Pro, 15, 15 Pro, 16
  844: 47, // 12, 13, 14, 16e
  812: 50, // 12 mini, 13 mini (X, XS, 11 Pro: 44)
};

function iosStatusBar(): number {
  const height = Math.max(screen.height, screen.width);
  // A phone newer than the table: the tallest bar known; one with a home
  // button: the classic 20.
  return IOS_STATUS_BAR[height] ?? (height >= 812 ? 62 : 20);
}

// Covers the tallest status bar of current phones, cutouts included.
const ANDROID_STATUS_BAR = 32;

function reportedInset(): number {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;top:0;height:env(safe-area-inset-top);visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  const inset = probe.offsetHeight;
  probe.remove();
  return inset;
}

function apply() {
  const root = document.documentElement.style;
  root.removeProperty("--safe-top");
  // Landscape hides the status bar altogether.
  if (window.innerWidth > window.innerHeight) return;
  if (reportedInset() > 0) return;
  // A bar reserved by the system leaves the page shorter than the screen:
  // the page starts below it, and there is nothing to make room for.
  if (window.innerHeight < screen.height - 1) return;
  root.setProperty("--safe-top", `${isIOS() ? iosStatusBar() : ANDROID_STATUS_BAR}px`);
}

export function guardSafeTop() {
  if (!isStandalone()) return;
  let frame = 0;
  const check = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(apply);
  };
  apply();
  // The steps of a cold launch, until the layout has settled.
  for (const delay of [50, 150, 300, 600, 1000, 2000, 3500]) window.setTimeout(check, delay);
  window.addEventListener("load", check);
  window.addEventListener("resize", check);
  window.addEventListener("pageshow", check);
  window.visualViewport?.addEventListener("resize", check);
  window.addEventListener("orientationchange", () => window.setTimeout(check, 300));
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && check());
}
