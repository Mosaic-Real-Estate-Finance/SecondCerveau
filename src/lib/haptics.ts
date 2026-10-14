import { isIOS } from "@/lib/standalone";

// One very light tick, as the system gives under a finger: the microphone
// opening, the recording ending.
//
// Android (Chromium): the Vibration API, a pulse of a few milliseconds.
// iPhone: Safari has no Vibration API. Since iOS 18 a switch control
// (<input type="checkbox" switch>) gives the system's own haptic tick when
// it flips, so a hidden one is flipped instead. Both only work inside a
// user's gesture; anywhere else this does nothing, silently, as it does on
// older systems and on a computer. On a touch screen the gesture is the
// finger lifting (pointerup, touchend), not landing: call it from a click or
// a pointerup.

const PULSE_MS = 8;

let toggle: HTMLLabelElement | null = null;

function iosSwitch() {
  if (!toggle) {
    toggle = document.createElement("label");
    toggle.setAttribute("aria-hidden", "true");
    toggle.style.display = "none";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.tabIndex = -1;
    toggle.appendChild(input);
    document.body.appendChild(toggle);
  }
  return toggle;
}

export function haptic() {
  if (typeof window === "undefined") return;
  try {
    if (isIOS()) iosSwitch().click();
    else navigator.vibrate?.(PULSE_MS);
  } catch {
    // No haptics here: nothing is lost.
  }
}

/**
 * Ticks when the finger now on the screen lifts — a press opens things at
 * once, but only its release counts as a gesture. A press that turns into
 * something else (a scroll, a cancel) ticks nothing.
 */
export function hapticOnRelease() {
  const lift = () => {
    haptic();
    drop();
  };
  const drop = () => {
    window.removeEventListener("pointerup", lift);
    window.removeEventListener("pointercancel", drop);
  };
  window.addEventListener("pointerup", lift, { once: true });
  window.addEventListener("pointercancel", drop, { once: true });
}
