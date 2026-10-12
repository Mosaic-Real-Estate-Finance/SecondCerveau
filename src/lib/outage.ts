import { useSyncExternalStore } from "react";
import { reportSttOutage } from "./api";

// A transcription outage only the account owner can fix: the Soniox credit
// is spent, its key refused, the server has none. Users are not shown the
// reason — it is not theirs to fix — but a banner saying the owner knows,
// and the owner gets a mail (functions/_lib/stt-outage.ts).
//
// Reported once per launch: the server keeps one alert per outage anyway,
// this only spares it a call per attempt.

export type OutageReason = "balance" | "key" | "config";

let current: OutageReason | null = null;
let reported = false;
const listeners = new Set<() => void>();
const publish = () => listeners.forEach((listener) => listener());

export function signalOutage(reason: OutageReason) {
  if (!reported) {
    reported = true;
    void reportSttOutage(reason).catch(() => {
      reported = false;
    });
  }
  if (current === reason) return;
  current = reason;
  publish();
}

export function dismissOutage() {
  current = null;
  publish();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The outage met during this launch, until the banner is closed. */
export const useOutage = () =>
  useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
