import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { startCapture, type Capture } from "./audio-capture";
import { removeNote, saveNote, toBytes, updateNote, type Note } from "./notes";
import { dropStream, startStream, wake } from "./pipeline";
import type { SonioxStream, StreamState } from "./soniox";

export type RecorderState = "idle" | "starting" | "recording" | "error";

/**
 * Why the recording is on hold without the user having asked: the link to the
 * transcription is down, or the app went to the background. It resumes by
 * itself when the reason goes away.
 */
export type Hold = "offline" | "background" | null;

/**
 * A stream down for less than this does not hold the recording: the buffer
 * covers a reconnection, and a hold that flashes on and off is only noise.
 */
const HOLD_AFTER_MS = 1500;

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
  const [hold, setHold] = useState<Hold>(null);
  // Set when the transcription refused for good. The recording goes on: it
  // is kept, and transcribed again once the service answers.
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [noteId, setNoteId] = useState<string | null>(null);
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
    link: SonioxStream;
    /** Paused by the user, held by the link or the tab: either stops the recording. */
    userPaused: boolean;
    hold: Hold;
    holdTimer: number;
    /** Removes the page listeners added for this recording. */
    detach: () => void;
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
    clearTimeout(current.holdTimer);
    current.detach();
    current.capture?.abort();
    current.source?.disconnect();
    current.context.close().catch(() => undefined);
    session.current = null;
    setStream(null);
    setHold(null);
    setUnavailable(null);
    setNoteId(null);
    wake.release();
  }, []);

  // One place decides whether sound is being recorded: the user's pause and
  // the hold both stop it, and only both gone resumes it.
  const apply = useCallback((current: NonNullable<typeof session.current>) => {
    const stop = current.userPaused || current.hold !== null;
    if (current.recorder.state === "inactive") return;
    try {
      if (stop && !current.pausedAt) {
        current.pausedAt = performance.now();
        current.recorder.pause();
        current.capture?.setPaused(true);
      } else if (!stop && current.pausedAt) {
        current.pausedTotal += performance.now() - current.pausedAt;
        current.pausedAt = 0;
        current.recorder.resume();
        current.capture?.setPaused(false);
      }
    } catch {
      // iOS may already have interrupted the recorder itself.
    }
    setPaused(current.userPaused);
    setHold(current.hold);
  }, []);

  // Unmounted mid recording — signed out with the panel open: the recorder
  // and the live stream stop with the screen. What was saved so far stays,
  // and is transcribed at the next launch (resumePending).
  useEffect(
    () => () => {
      const current = session.current;
      if (current) {
        if (current.recorder.state !== "inactive") current.recorder.stop();
        dropStream(current.note.id);
      }
      teardown();
    },
    [teardown],
  );

  // Each press of the microphone, numbered: a start still waiting for the
  // microphone when « Annuler » is pressed must not carry on behind the
  // closed panel once it is granted.
  const generation = useRef(0);

  // Called from pointerdown. The audio context is created before any await,
  // inside the gesture, which is what Safari requires to let it run.
  const start = useCallback(async () => {
    if (session.current) return;
    const mine = ++generation.current;
    setError(null);
    setPaused(false);
    setMeter({ amplitudes: [], elapsed: 0 });
    const context = new AudioContext();
    void context.resume();
    let streamId: string | null = null;
    try {
      let stream = isLive(warmStream) ? warmStream! : null;
      if (!stream) {
        setState("starting");
        stream = await warmMicrophone();
        if (!stream) stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
        warmStream = stream;
      }
      if (generation.current !== mine) {
        context.close().catch(() => undefined);
        return;
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

      // The transcription stream opens now, in parallel with everything else.
      // What is said before it is connected waits in its buffer.
      streamId = note.id;
      const onLink = (link: StreamState) => {
        if (session.current !== current) return;
        clearTimeout(current.holdTimer);
        if (link === "failed") {
          // Not the network, and nothing a pause would wait out: the
          // recording carries on and the reason is said as it is.
          setUnavailable(current.link.error?.message ?? "le service ne répond pas");
          if (current.hold) {
            current.hold = null;
            apply(current);
          }
        } else if (link === "live") {
          // Back: a hold for the link ends here; one for the background ends
          // when the app is in front, which it must be for this to happen.
          if (current.hold && document.visibilityState === "visible") {
            current.hold = null;
            apply(current);
          }
        } else if (link === "down" && !current.hold) {
          current.holdTimer = window.setTimeout(() => {
            if (session.current !== current || current.link.state === "live") return;
            current.hold = document.visibilityState === "visible" ? "offline" : "background";
            apply(current);
          }, HOLD_AFTER_MS);
        }
      };
      const live = startStream(note.id, onLink);

      const current = {
        note,
        recorder,
        stream,
        context,
        source,
        capture: null as Capture | null,
        link: live,
        userPaused: false,
        hold: null as Hold,
        holdTimer: 0,
        detach: () => undefined,
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

      // After the recorder, never before it: registering the processor costs
      // a few milliseconds and they must not come out of the recording.
      void startCapture(source, (pcm) => live.push(pcm)).then((capture) => {
        if (capture && session.current === current) current.capture = capture;
        else if (!capture) dropStream(note.id);
      });

      // iOS suspends the tab when the screen locks or another app comes
      // forward, and the socket dies with it, usually without saying so. The
      // recording is held and the socket let go on the way out; on the way
      // back the stream reconnects, replays what Soniox had not confirmed,
      // and the recording resumes once it is live again.
      const away = () => {
        if (session.current !== current) return;
        clearTimeout(current.holdTimer);
        current.hold = "background";
        apply(current);
        current.link.suspend();
        // Whatever the recorder has so far, in case the tab does not return.
        void toBytes(new Blob(chunks, { type: recorder.mimeType })).then((audio) =>
          updateNote(note.id, { audio, duration: captured(current), amplitudes: [...current.amplitudes] }),
        );
      };
      const back = () => {
        if (session.current !== current || document.visibilityState !== "visible") return;
        current.link.resume();
        if (current.link.state === "live" && current.hold === "background") {
          current.hold = null;
          apply(current);
        }
      };
      const onVisibility = () => (document.visibilityState === "hidden" ? away() : back());
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("pagehide", away);
      window.addEventListener("pageshow", back);
      current.detach = () => {
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("pagehide", away);
        window.removeEventListener("pageshow", back);
      };

      const samples = new Float32Array(analyser.fftSize);

      // Each second's chunk goes to IndexedDB every few seconds, so a tab
      // killed mid dictation still leaves a playable, transcribable prefix.
      // Merged into the note rather than written over it: the live text is on
      // it too. A save still in flight when the recording stops is dropped,
      // so it cannot put a shorter recording back over the full one.
      current.saveTimer = window.setInterval(() => {
        void toBytes(new Blob(chunks, { type: recorder.mimeType })).then((audio) => {
          if (session.current !== current) return;
          return updateNote(note.id, { audio, duration: captured(current), amplitudes: [...current.amplitudes] });
        });
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
      setNoteId(note.id);
    } catch (cause) {
      if (streamId) dropStream(streamId);
      context.close().catch(() => undefined);
      teardown();
      const denied = (cause as DOMException)?.name === "NotAllowedError";
      setError(denied ? "Accès au micro refusé. Autorisez-le dans les réglages du navigateur." : "Micro indisponible.");
      setState("error");
    }
  }, [teardown, apply]);

  // Holds the recording where it is. The microphone stays open, so resuming
  // is instant; nothing is captured meanwhile.
  const togglePause = useCallback(() => {
    const current = session.current;
    if (!current || current.recorder.state === "inactive") return;
    current.userPaused = !current.userPaused;
    apply(current);
  }, [apply]);

  // Resolves with the saved note, ready for transcription. A second press of
  // « Terminer » while the first is finishing gets the same answer, not a
  // second note.
  const stopping = useRef<Promise<Note | null> | null>(null);
  const stop = useCallback((): Promise<Note | null> => {
    if (!stopping.current) {
      stopping.current = finish().finally(() => {
        stopping.current = null;
      });
    }
    return stopping.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teardown]);

  const finish = async (): Promise<Note | null> => {
    const current = session.current;
    if (!current) return null;
    clearInterval(current.saveTimer);
    const duration = captured(current);
    // The live transcript is only used if the capture heard the dictation
    // through. A graph interrupted on the way — a call coming in — would give
    // a text with its middle missing, which is far worse than one that took
    // longer to arrive. (Holds pause both clocks alike, so they do not count.)
    const heard = current.capture?.seconds() ?? 0;
    // The processor is registered a few milliseconds after the recorder
    // starts, and the last partial block is never sent: under a second of
    // slack covers both, and nothing like the gap an interruption leaves.
    if (!current.capture || heard < duration - 0.8) {
      dropStream(current.note.id);
      current.capture?.abort();
    } else {
      // The last quarter second, before anything is torn down. The stream
      // itself is finalised by the transcription, which takes it from here.
      await current.capture.end();
    }
    if (current.recorder.state === "paused") current.recorder.resume();
    if (current.recorder.state !== "inactive") current.recorder.stop();
    // The first save is only a safety net against a killed tab; the full one
    // below replaces it, so its failure must not hold up the recording.
    const [audio] = await Promise.all([current.stopped, current.ready.catch(() => undefined)]);
    const fields = { status: "recorded" as const, audio, duration, amplitudes: current.amplitudes };
    teardown();
    // Awaited: what follows reads the note back, and an unfinished write
    // would hand it the partial audio saved while recording. Merged, so the
    // live text stays on it until the final one replaces it.
    const note = (await updateNote(current.note.id, fields)) ?? (await saveNote({ ...current.note, ...fields }));
    setPaused(false);
    setState("idle");
    return note;
  };

  const cancel = useCallback(async () => {
    const current = session.current;
    if (!current) {
      generation.current++;
      return setState("idle");
    }
    if (current.recorder.state !== "inactive") current.recorder.stop();
    dropStream(current.note.id);
    await current.ready.catch(() => undefined);
    teardown();
    await removeNote(current.note.id);
    setPaused(false);
    setState("idle");
  }, [teardown]);

  return { state, paused, hold, unavailable, noteId, error, stream, start, stop, cancel, togglePause };
}
