// Is the app running from the home screen rather than a browser tab?
// iOS never sets display-mode on older versions, hence navigator.standalone.
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const byDisplayMode = window.matchMedia?.("(display-mode: standalone)")?.matches;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return Boolean(byDisplayMode || iosStandalone);
}

export function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|IEMobile|BlackBerry|Opera Mini|Mobile/i.test(ua)) return true;
  // iPadOS 13+ presents itself as a desktop Mac; the touch points give it away.
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

export const isIOS = () =>
  typeof navigator !== "undefined" &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

export type Platform = "ios-safari" | "ios-inapp" | "android" | "android-inapp" | "desktop";

// The browsers embedded in other apps: none of them can add to the home
// screen, so the invitation has to send the reader to Safari instead.
const IN_APP =
  /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|Line\/|Snapchat|Twitter|TikTok|musical_ly|Bytedance|Pinterest|WhatsApp|GSA\//i;

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  const inApp = IN_APP.test(ua);
  if (isIOS()) {
    // Chrome, Firefox and Edge on iOS offer no such thing: same dead end.
    const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    return inApp || otherBrowser ? "ios-inapp" : "ios-safari";
  }
  if (/Android/i.test(ua)) return inApp || /; wv\)/.test(ua) ? "android-inapp" : "android";
  return "desktop";
}

// Chromium fires this instead of offering the browser's own bar; keeping the
// event lets the app show the native dialog from its own button. Captured at
// module load because the event fires early, often before React mounts.
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as InstallEvent;
    listeners.forEach((listener) => listener());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((listener) => listener());
  });
}

export const canPromptInstall = () => deferred !== null;

export function subscribeInstall(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Resolves true when the app was installed through the native dialog.
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const event = deferred;
  deferred = null;
  listeners.forEach((listener) => listener());
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome === "accepted";
}

const DISMISSED_KEY = "mosaic-install-dismissed";

export const installPrompt = {
  dismissed(): boolean {
    try {
      return localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      // Storage blocked (private mode): the invitation shows again later.
      return false;
    }
  },
  dismiss() {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Nothing to remember it with; not worth blocking on.
    }
  },
};
