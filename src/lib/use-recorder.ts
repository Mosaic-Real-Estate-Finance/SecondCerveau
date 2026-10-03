import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { startCapture, type Capture } from "./audio-capture";
import { guardEnd, guardStart, liveAllowed } from "./engine-guard";
import { abandonLive, beginLive, pushSegment } from "./live-transcript";
import { removeNote, saveNote, toBytes, type Note } from "./notes";
import { wake } from "./pipeline";
import { warmEngine } from "./transcriber";

export type RecorderState = "idle" | "starting" | "recording" | "error";

// mp4 first: Safari only records mp4, and every engine decodes it.
const MIME_TYPES = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
const SAMPLE_EVERY_MS = 100;
const SAVE_EVERY_MS = 5000;
const CONSTRAINTS: MediaStreamConstraints = {
  audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};

// Speech RMS sits roughly between 0.01 and 0.3: the square root spreads it
// over the bar height the way the ear hears loudness.
const toAmplitude = (rms: number) => Math.min(1, Math.max(0.08, Math.sqrt(rms) * 2.2));

// ---- Live meter ---------------------------------------------------------
// Amplitudes and elapsed time change ten times a second. They live outside
// React state so that only the pill that draws them re-renders, not the
// whole screen around it.

type Meter = { amplitudes: number[]; elapsed: number };
let meter: Meter = { amplitudes: [], elapsed: 0 };
const meterListeners = new Set<() => void>();

function setMeter(next: Meter) {
  meter = next;
  meterListeners.forEach((listener) => listener());
}

export function useMeter() {
  return useSyncExternalStore(
    (listener) => {
      meterListeners.add(listener);
      return () => meterListeners.delete(listener);
    },
    () => meter,
  );
}

// ---- Warm microphone ----------------------------------------------------
// Opening the microphone takes a few hundred milliseconds on a phone, and the
// first words spoken meanwhile are lost. The home screen keeps it open while
// visible, so a press starts recording at once. Nothing is recorded or sent
// until the button is pressed.

let warmStream: MediaStream | null = null;
let warming: Promise<MediaStream | null> | null = null;

const isLive = (stream: MediaStream | null) =>
  !!stream && stream.getAudioTracks().some((track) => track.readyState === "live");

export function warmMicrophone() {
  if (isLive(warmStream)) return Promise.resolve(warmStream);
  warming ??= navigator.mediaDevices
    .getUserMedia(CONSTRAINTS)
    .then((stream) => (warmStream = stream))
    .catch(() => null)
    .finally(() => {
      warming = null;
    });
  return warming;
}

export function coolMicrophone() {
  warmStream?.getTracks().forEach((track) => track.stop());
  warmStream = null;
}

// ---- Recorder -------------------------------------------------------------

// Seconds of sound captured so far: wall clock, less the time on hold.
type Timed = { startedAt: number; pausedTotal: number; pausedAt: number };
const captured = ({ startedAt, pausedTotal, pausedAt }: Timed) =>
  (performance.now() - startedAt - pausedTotal - (pausedAt ? performance.now() - pausedAt : 0)) / 1000;

export function useRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shared with the screen glow, which listens to the same microphone.
  const [stream, setStream] = useState<MediaStream | null>(null);

  const session = useRef<{
    note: Note;
    recorder: MediaRecorder;
    stream: MediaStream;
    context: AudioContext;
    source: MediaStreamAudioSourceNode | null;
    /** Null when this browser has no live path: the file is done at the end. */
    capture: Capture | null;
    chunks: Blob[];
    amplitudes: number[];
    startedAt: number;
    // Time already spent on hold, plus the instant the current hold began.
    pausedTotal: number;
    pausedAt: number;
    frame: number;
    saveTimer: number;
    stopped: Promise<ArrayBuffer>;
    ready: Promise<unknown>;
  } | null>(null);

  // The stream itself stays open: the screen decides when to release it.
  const teardown = useCallback(() => {
    const current = session.current;
    if (!current) return;
    cancelAnimationFrame(current.frame);
    clearInterval(current.saveTimer);
    current.capture?.abort();
    current.source?.disconnect();
    current.context.close().catch(() => undefined);
    session.current = null;
    setStream(null);
    wake.release();
  }, []);

  useEffect(() => teardown, [teardown]);

  // Called from pointerdown. The audio context is created before any await,
  // inside the gesture, which is what Safari requires to let it run.
  const start = useCallback(async () => {
    if (session.current) return;
    setError(null);
    setPaused(false);
    setMeter({ amplitudes: [], elapsed: 0 });
    const context = new AudioContext();
    void context.resume();
    let liveId: string | null = null;
    try {
      let stream = isLive(warmStream) ? warmStream! : null;
      if (!stream) {
        setState("starting");
        stream = await warmMicrophone();
        if (!stream) stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
        warmStream = stream;
      }

      // Recording first; everything else follows without holding it back.
      const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 48000 } : undefined);
      const chunks: Blob[] = [];
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size) chunks.push(event.data);
      });
      // Read into memory as soon as the recorder is done: WebKit will not
      // store a MediaRecorder Blob in IndexedDB, and by the time it refuses
      // the recording is already over. See the note at the top of notes.ts.
      const stopped = new Promise<ArrayBuffer>((resolve, reject) =>
        recorder.addEventListener(
          "stop",
          () => toBytes(new Blob(chunks, { type: recorder.mimeType })).then(resolve, reject),
          { once: true },
        ),
      );
      recorder.start(1000);
      const startedAt = performance.now();
      setStream(stream);
      setState("recording");

      const note: Note = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        status: "recording",
        audio: new ArrayBuffer(0),
        mimeType: recorder.mimeType,
        duration: 0,
        amplitudes: [],
      };
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);

      const current = {
        note,
        recorder,
        stream,
        context,
        source,
        capture: null as Capture | null,
        chunks,
        amplitudes: [] as number[],
        startedAt,
        pausedTotal: 0,
        pausedAt: 0,
        frame: 0,
        saveTimer: 0,
        stopped,
        ready: Promise.all([saveNote(note), wake.acquire()]),
      };
      session.current = current;

      // Transcribing the dictation as it is spoken means holding the whole
      // model in memory while the microphone is open. That is the part a
      // phone may refuse, so it happens behind the breadcrumb: a tab that
      // does not come back from it drops to the plain path by itself, on
      // its own next launch, and stays there.
      if (liveAllowed()) {
        liveId = note.id;
        beginLive(note.id);
        guardStart("dictée transcrite en direct");
        // Nothing is downloaded here; it returns at once if the weights are
        // not on the device yet.
        void warmEngine();
        // After the recorder, never before it: registering the processor
        // costs a few milliseconds and they must not come out of the
        // recording.
        void startCapture(source, (pcm) => pushSegment(note.id, pcm)).then((capture) => {
          if (capture && session.current === current) current.capture = capture;
          else abandonLive(note.id);
        });
      }

      const samples = new Float32Array(analyser.fftSize);

      // Each second's chunk goes to IndexedDB every few seconds, so a tab
      // killed mid dictation still leaves a playable, transcribable prefix.
      current.saveTimer = window.setInterval(() => {
        void toBytes(new Blob(chunks, { type: recorder.mimeType })).then((audio) =>
          saveNote({ ...note, audio, duration: captured(current), amplitudes: [...current.amplitudes] }),
        );
      }, SAVE_EVERY_MS);

      let lastSample = 0;
      const tick = (now: number) => {
        // On hold nothing is sampled: the bars and the counter stay where the
        // recording stopped, and pick up from there.
        if (!current.pausedAt && now - lastSample >= SAMPLE_EVERY_MS) {
          lastSample = now;
          analyser.getFloatTimeDomainData(samples);
          let sum = 0;
          for (const value of samples) sum += value * value;
          current.amplitudes.push(toAmplitude(Math.sqrt(sum / samples.length)));
          setMeter({ amplitudes: [...current.amplitudes], elapsed: Math.floor(captured(current)) });
        }
        current.frame = requestAnimationFrame(tick);
      };
      current.frame = requestAnimationFrame(tick);
    } catch (cause) {
      if (liveId) abandonLive(liveId);
      context.close().catch(() => undefined);
      teardown();
      const denied = (cause as DOMException)?.name === "NotAllowedError";
      setError(denied ? "Accès au micro refusé. Autorisez-le dans les réglages du navigateur." : "Micro indisponible.");
      setState("error");
    }
  }, [teardown]);

  // Holds the recording where it is. The microphone stays open, so resuming
  // is instant; nothing is captured meanwhile.
  const togglePause = useCallback(() => {
    const current = session.current;
    if (!current || current.recorder.state === "inactive") return;
    if (current.pausedAt) {
      current.pausedTotal += performance.now() - current.pausedAt;
      current.pausedAt = 0;
      current.recorder.resume();
      current.capture?.setPaused(false);
      setPaused(false);
    } else {
      current.pausedAt = performance.now();
      current.recorder.pause();
      current.capture?.setPaused(true);
      setPaused(true);
    }
  }, []);

  // Resolves with the saved note, ready for transcription.
  const stop = useCallback(async (): Promise<Note | null> => {
    const current = session.current;
    if (!current) return null;
    clearInterval(current.saveTimer);
    const duration = captured(current);
    // The live transcript is only used if the capture heard the dictation
    // through. A graph interrupted on the way — a call coming in, the app
    // sent to the background — would give a text with its middle missing,
    // which is far worse than one that took longer to arrive.
    const heard = current.capture?.seconds() ?? 0;
    // The processor is registered a few milliseconds after the recorder
    // starts, and the last partial block is never sent: under a second of
    // slack covers both, and nothing like the gap an interruption leaves.
    if (!current.capture || heard < duration - 0.8) {
      abandonLive(current.note.id);
      current.capture?.abort();
    } else {
      // The last utterance, before anything is torn down. It joins the queue
      // behind the ones already running, so what is left to wait for is one
      // pass.
      const tail = await current.capture.end();
      if (tail) pushSegment(current.note.id, tail);
    }
    if (current.recorder.state === "paused") current.recorder.resume();
    if (current.recorder.state !== "inactive") current.recorder.stop();
    // The first save is only a safety net against a killed tab; the full one
    // below replaces it, so its failure must not hold up the recording.
    const [audio] = await Promise.all([current.stopped, current.ready.catch(() => undefined)]);
    const note: Note = {
      ...current.note,
      status: "recorded",
      audio,
      duration,
      amplitudes: current.amplitudes,
    };
    teardown();
    // Awaited: what follows reads the note back, and an unfinished write
    // would hand it the partial audio saved while recording.
    await saveNote(note);
    setPaused(false);
    setState("idle");
    return note;
  }, [teardown]);

  const cancel = useCallback(async () => {
    const current = session.current;
    if (!current) return setState("idle");
    if (current.recorder.state !== "inactive") current.recorder.stop();
    abandonLive(current.note.id);
    guardEnd();
    await current.ready;
    teardown();
    await removeNote(current.note.id);
    setPaused(false);
    setState("idle");
  }, [teardown]);

  return { state, paused, error, stream, start, stop, cancel, togglePause };
}
