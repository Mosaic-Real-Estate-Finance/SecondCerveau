import { useCallback, useEffect, useRef, useState } from "react";

// Whether a dictation can be transcribed right now.
//
// The transcription happens live, on Soniox's servers: without a working
// connection a recording would only pile up audio that nothing can turn into
// text. So the home screen does not offer to record until the network has
// answered, and says so when it does not.
//
// `navigator.onLine` alone is not enough. It says whether there is an
// interface, not whether anything gets through, and a phone on the edge of a
// Wi-Fi network or in a train reports "online" while every request times
// out. The answer is a probe: a tiny request to our own origin, timed.
//
// One slow or failed answer can be noise — a radio waking up, a cell
// handover — so a bad probe is confirmed by a second one before the screen
// changes. A good one is believed at once.

export type Connectivity = "checking" | "online" | "unstable" | "offline";

/** Beyond this, a probe of a few hundred bytes says the link is unusable. */
const SLOW_MS = 3000;
/** Given up on: the link is down, whatever the interface says. */
const TIMEOUT_MS = 6000;
/** How often the link is checked while the home screen is on show. */
const EVERY_MS = 20000;
/** …and while it is bad, so it comes back on its own as soon as it can. */
const RECOVER_MS = 4000;

type Probe = "ok" | "slow" | "failed";

async function probe(): Promise<Probe> {
  if (!navigator.onLine) return "failed";
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = performance.now();
  try {
    // A query the service worker has never cached, so the answer is the
    // network's, never the precache's.
    const response = await fetch(`/favicon.svg?probe=${Date.now()}`, { cache: "no-store", signal: controller.signal });
    if (!response.ok) return "failed";
    await response.arrayBuffer();
    return performance.now() - started > SLOW_MS ? "slow" : "ok";
  } catch {
    return "failed";
  } finally {
    window.clearTimeout(timer);
  }
}

const verdict = (result: Probe): Connectivity =>
  result === "ok" ? "online" : result === "slow" || navigator.onLine ? "unstable" : "offline";

/** Checks the link while `active`, and on every change the phone reports. */
export function useConnectivity(active: boolean) {
  // Optimistic at launch: a phone that says it is online usually is, and the
  // first probe corrects it within seconds without a screen flashing past.
  const [status, setStatus] = useState<Connectivity>(() => (navigator.onLine ? "online" : "offline"));
  const statusRef = useRef(status);
  statusRef.current = status;
  const running = useRef(false);
  const timer = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;

  const check = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    window.clearTimeout(timer.current);
    try {
      if (statusRef.current !== "online") setStatus("checking");
      let result = await probe();
      // Confirmed before believed, unless the phone has no network at all.
      if (result !== "ok" && navigator.onLine) result = await probe();
      const next = verdict(result);
      statusRef.current = next;
      setStatus(next);
    } finally {
      running.current = false;
      if (activeRef.current && document.visibilityState === "visible") {
        timer.current = window.setTimeout(
          () => void check(),
          statusRef.current === "online" ? EVERY_MS : RECOVER_MS,
        );
      }
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const offline = () => {
      statusRef.current = "offline";
      setStatus("offline");
      void check();
    };
    const recheck = () => document.visibilityState === "visible" && void check();
    void check();
    window.addEventListener("offline", offline);
    window.addEventListener("online", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.clearTimeout(timer.current);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [active, check]);

  return { status, check };
}
