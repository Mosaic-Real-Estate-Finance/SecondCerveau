// Stands in for src/lib/use-recorder.ts in the screenshot build: a dictation
// already under way, with a live meter and a voice for the glow.
import { useEffect, useState, useSyncExternalStore } from "react";
import { play, syntheticVoice } from "./dictation";

export type RecorderState = "idle" | "starting" | "recording" | "error";
export type Hold = "offline" | "background" | null;

let meter = { amplitudes: [] as number[], elapsed: 0 };
const meterListeners = new Set<() => void>();
let meterTimer = 0;

function runMeter() {
  window.clearInterval(meterTimer);
  const started = performance.now() - 23_000; // 0:23 into the dictation
  meterTimer = window.setInterval(() => {
    const amplitude = Math.min(1, 0.15 + Math.random() * 0.75);
    meter = { amplitudes: [...meter.amplitudes, amplitude].slice(-80), elapsed: (performance.now() - started) / 1000 };
    meterListeners.forEach((listener) => listener());
  }, 100);
}

export function useMeter() {
  return useSyncExternalStore(
    (listener) => {
      meterListeners.add(listener);
      return () => void meterListeners.delete(listener);
    },
    () => meter,
  );
}

export function useRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  useEffect(() => () => window.clearInterval(meterTimer), []);
  const noop = () => undefined;
  return {
    state,
    paused: false,
    hold: null as Hold,
    unavailable: null as string | null,
    noteId: state === "recording" ? "demo" : null,
    error: null as string | null,
    stream,
    shelved: false,
    start: async () => {
      setStream(syntheticVoice());
      runMeter();
      // ?words=N stops the text after N words, for a frame mid sentence.
      play(Number(new URLSearchParams(location.search).get("words")) || undefined);
      setState("recording");
    },
    stop: async () => null,
    cancel: noop,
    togglePause: noop,
  };
}
