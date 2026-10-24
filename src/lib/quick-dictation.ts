import { useCallback, useEffect, useRef, useState } from "react";
import { startCapture, type Capture } from "./audio-capture";
import { openStream, type SonioxStream } from "./soniox";

// A short dictation into a text field — the feedback form's microphone. The
// same Soniox stream as a note, without what a note needs around it: no
// recording kept, no store, no hold and resume. What is said comes back as
// text, live, and the whole of it once finished.

export type QuickState = "idle" | "starting" | "live" | "finishing" | "error";

const CONSTRAINTS: MediaStreamConstraints = {
  audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};
const SAMPLE_EVERY_MS = 100;
// As the note recorder draws its bars (use-recorder.ts).
const toAmplitude = (rms: number) => Math.min(1, Math.max(0.08, Math.sqrt(rms) * 2.2));

type Session = {
  context: AudioContext;
  media: MediaStream;
  link: SonioxStream;
  capture: Capture | null;
  timer: number;
};

export function useQuickDictation() {
  const [state, setState] = useState<QuickState>("idle");
  const [text, setText] = useState("");
  const [amplitudes, setAmplitudes] = useState<number[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const session = useRef<Session | null>(null);
  // What has been heard so far, kept if finishing fails: better than nothing.
  const heard = useRef("");

  const teardown = useCallback(() => {
    const current = session.current;
    if (!current) return;
    session.current = null;
    clearInterval(current.timer);
    current.media.getTracks().forEach((track) => track.stop());
    current.context.close().catch(() => undefined);
  }, []);

  const cancel = useCallback(() => {
    const current = session.current;
    current?.capture?.abort();
    current?.link.abort();
    teardown();
    setState("idle");
  }, [teardown]);

  // Leaving the screen mid sentence lets the microphone go.
  useEffect(() => cancel, [cancel]);

  /** From the tap itself: Safari only lets an audio context run from a gesture. */
  const start = useCallback(async () => {
    if (session.current) return;
    const context = new AudioContext();
    void context.resume();
    setError(null);
    setText("");
    setAmplitudes([]);
    setElapsed(0);
    setState("starting");
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
    } catch {
      context.close().catch(() => undefined);
      setError("Le micro n'est pas autorisé.");
      setState("error");
      return;
    }
    const source = context.createMediaStreamSource(media);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    heard.current = "";
    const link = openStream({
      onText: (next) => {
        heard.current = next;
        setText(next);
      },
    });
    const startedAt = performance.now();
    const samples = new Float32Array(analyser.fftSize);
    const bars: number[] = [];
    const timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      bars.push(toAmplitude(Math.sqrt(sum / samples.length)));
      setAmplitudes(bars.slice(-80));
      setElapsed((performance.now() - startedAt) / 1000);
    }, SAMPLE_EVERY_MS);
    const current: Session = { context, media, link, capture: null, timer };
    session.current = current;
    setState("live");
    const capture = await startCapture(source, (pcm) => link.push(pcm));
    if (session.current !== current) return capture?.abort();
    if (!capture) {
      cancel();
      setError("La dictée n'est pas disponible sur cet appareil.");
      setState("error");
      return;
    }
    current.capture = capture;
  }, [cancel]);

  /** Stops listening and resolves the whole text. */
  const finish = useCallback(async (): Promise<string> => {
    const current = session.current;
    if (!current) return "";
    setState("finishing");
    try {
      await current.capture?.end();
      const whole = await current.link.finish();
      return whole;
    } catch (cause) {
      setError((cause as Error).message || "La transcription n'a pas abouti.");
      return heard.current;
    } finally {
      teardown();
      setState("idle");
    }
  }, [teardown]);

  return { state, text, amplitudes, elapsed, error, start, finish, cancel };
}
