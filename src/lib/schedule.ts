// The page transition is 250 ms of opacity, transform and blur on a
// full-screen layer. Anything heavy started in the same tick — decoding the
// audio, waking the Whisper worker — lands on those frames and shows as a
// stutter. These two helpers keep that work off them.

const ms = (name: string, fallback: number) => {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const value = parseFloat(raw);
  if (!Number.isFinite(value)) return fallback;
  return raw.endsWith("ms") || !raw.endsWith("s") ? value : value * 1000;
};

/** How long a page slide lasts, read from the transition tokens. */
export const pageSlideMs = () => ms("--page-slide-dur", 250) + ms("--page-stagger", 0);

type IdleWindow = Window & {
  requestIdleCallback?: (task: () => void, options?: { timeout: number }) => number;
};

/**
 * Runs the task once the page slide is over and the main thread is free.
 * A margin covers the frame the transition ends on; the idle callback keeps
 * it behind anything the new screen still has to paint.
 */
export function afterTransition(task: () => void) {
  window.setTimeout(() => {
    const idle = (window as IdleWindow).requestIdleCallback;
    if (idle) idle(task, { timeout: 600 });
    else requestAnimationFrame(() => window.setTimeout(task, 0));
  }, pageSlideMs() + 60);
}
