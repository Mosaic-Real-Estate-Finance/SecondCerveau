import { ApiError, createNotionNote, recentContacts } from "./api";
import { decodeTo16k } from "./audio";
import { getNote, listNotes, ready, removeNote, updateNote } from "./notes";
import { openStream, SttError, type SonioxStream, type StreamState } from "./soniox";

// ---- Screen wake lock ---------------------------------------------------
// iOS suspends a tab as soon as the screen locks, which stops both the
// recorder and the stream. Holding the lock while either runs avoids most of
// it; the stream's replay and the IndexedDB resume cover the rest.

type Sentinel = { released: boolean; release(): Promise<void>; addEventListener(type: "release", fn: () => void): void };

let wakeLock: Sentinel | null = null;
// One request at a time: two holders asking together would otherwise take two
// locks, and the first, overwritten, would never be released.
let requesting: Promise<void> | null = null;
let holders = 0;

function take() {
  if (wakeLock || requesting || holders === 0) return;
  const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<Sentinel> } };
  if (!nav.wakeLock) return;
  requesting = nav.wakeLock
    .request("screen")
    .then((sentinel) => {
      // Released by the browser when the page is hidden: forgotten, so the
      // return to the page takes a new one.
      sentinel.addEventListener("release", () => {
        if (wakeLock === sentinel) wakeLock = null;
      });
      if (holders === 0) void sentinel.release().catch(() => undefined);
      else wakeLock = sentinel;
    })
    .catch(() => {
      // Refused (low battery, background tab): carry on without it.
    })
    .finally(() => {
      requesting = null;
    });
}

async function acquire() {
  holders++;
  take();
  await requesting;
}

function release() {
  holders = Math.max(0, holders - 1);
  if (holders === 0 && wakeLock) {
    void wakeLock.release().catch(() => undefined);
    wakeLock = null;
  }
}

// The browser drops the lock when the page is hidden; take it back on return.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") take();
});

export const wake = { acquire, release };

// Sends on their way, for `busy` below.
let sending = 0;

/** Recording, transcribing or sending: no moment to reload the app. */
export const busy = () => holders > 0 || sending > 0;

// ---- Transcription --------------------------------------------------------
//
// The dictation is transcribed while it is spoken: the recorder streams it
// to Soniox (soniox.ts) and the text lands on the note as `partial`. When the
// user stops, what is left is to finalise the stream — a second or so.
//
// The recording itself is still kept until Notion confirms the note. It is
// what makes a lost stream recoverable: a tab killed mid dictation, a capture
// that missed part of it, or a buffer that could not cover a long outage all
// end the same way — the stored audio is streamed again, from the start.

/** Live streams, by note. Set when recording starts, taken when it is transcribed. */
const streams = new Map<string, SonioxStream>();

// Several messages a second come back; the screen needs a few. Memory only,
// see updateNote.
const PARTIAL_MS = 150;
const partialTimers = new Map<string, number>();
const latest = new Map<string, string>();

function showPartial(id: string, text: string) {
  latest.set(id, text);
  if (partialTimers.has(id)) return;
  partialTimers.set(
    id,
    window.setTimeout(() => {
      partialTimers.delete(id);
      void updateNote(id, { partial: latest.get(id) }, { durable: false });
    }, PARTIAL_MS),
  );
}

// The live text stops where the final one begins: a timer still pending
// would otherwise write the partial back over it.
function stopPartial(id: string) {
  window.clearTimeout(partialTimers.get(id));
  partialTimers.delete(id);
  latest.delete(id);
}

/** Opens the stream for a recording that has just started. */
export function startStream(id: string, onState: (state: StreamState) => void) {
  const stream = openStream({ onText: (text) => showPartial(id, text), onState });
  streams.set(id, stream);
  return stream;
}

/** The live stream will not carry this dictation; the recording will. */
export function dropStream(id: string) {
  streams.get(id)?.abort();
  streams.delete(id);
  stopPartial(id);
}

// What failed, in French, for the line under the send button.
function reason(error: unknown) {
  // The account's problem, not the user's: its detail goes to the owner.
  if (error instanceof SttError && error.outage) return "outil de transcription indisponible, Théo est prévenu";
  if (error instanceof SttError || error instanceof ApiError) return error.message;
  const message = String((error as Error)?.message ?? error);
  return /decod|EncodingError/i.test(message) ? "enregistrement illisible" : message;
}

// Soniox wants audio at about the speed it was spoken. 120 ms every 100 ms
// keeps a little ahead without being a burst.
const REPLAY_SAMPLES = 1920;
const REPLAY_EVERY_MS = 100;
// Without a link for this long, the replay gives up: the note says so and
// offers to try again, rather than holding the screen awake indefinitely.
const REPLAY_WAIT_MS = 60_000;

/** The stored recording, streamed again from its first second. */
async function streamRecording(id: string, audio: ArrayBuffer) {
  const pcm = await decodeTo16k(audio);
  const stream = openStream({ onText: (text) => showPartial(id, text) });
  try {
    for (let at = 0; at < pcm.length; at += REPLAY_SAMPLES) {
      // Paused while the link is down, so the buffer never has to hold it.
      const since = Date.now();
      while (stream.state !== "live") {
        if (stream.error) throw stream.error;
        if (Date.now() - since > REPLAY_WAIT_MS) throw new SttError("pas de connexion", false);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      stream.push(pcm.subarray(at, at + REPLAY_SAMPLES));
      await new Promise((resolve) => setTimeout(resolve, REPLAY_EVERY_MS));
    }
    return await stream.finish();
  } catch (error) {
    stream.abort();
    throw error;
  }
}

const running = new Set<string>();

export async function transcribeNote(id: string): Promise<void> {
  if (running.has(id)) return;
  const note = await getNote(id);
  if (!note || note.transcript) return;

  running.add(id);
  await acquire();
  try {
    await updateNote(id, { status: "transcribing", error: undefined });
    let text: string | null = null;
    const stream = streams.get(id);
    streams.delete(id);
    if (stream) {
      try {
        const live = await stream.finish();
        if (stream.complete) text = live;
      } catch (error) {
        // Signed out or misconfigured: streaming the recording again would
        // meet the same answer.
        if (error instanceof SttError && error.lasting) throw error;
      }
    }
    if (text === null) text = await streamRecording(id, note.audio);
    stopPartial(id);
    if (!text) {
      await updateNote(id, { status: "transcription-failed", error: "aucune parole détectée", partial: undefined });
      return;
    }
    await updateNote(id, { status: "transcribed", transcript: text, partial: undefined, outage: undefined });
  } catch (error) {
    stopPartial(id);
    const outage = error instanceof SttError && error.outage !== null;
    await updateNote(id, { status: "transcription-failed", error: reason(error), partial: undefined, outage });
  } finally {
    if (running.delete(id)) release();
  }
}

// ---- Sending --------------------------------------------------------------

export async function sendNote(id: string, files: { id: string; name: string }[] = []) {
  const note = await getNote(id);
  if (!note?.transcript || note.contact === undefined) throw new Error("Note incomplète");
  await updateNote(id, { status: "sending", error: undefined });
  sending++;
  try {
    const page = await createNotionNote({
      clientId: note.id,
      transcript: note.transcript,
      contactId: note.contact?.id ?? null,
      recordedAt: new Date(note.createdAt).toLocaleDateString("sv-SE"),
      files,
    });
    if (note.contact) recentContacts.push(note.contact.id);
    // Notion confirmed the page: only now is the audio let go.
    await removeNote(id);
    return page;
  } catch (error) {
    await updateNote(id, { status: "send-failed", error: (error as Error).message });
    throw error;
  } finally {
    sending--;
  }
}

// ---- Resume ---------------------------------------------------------------

// Picks up whatever a closed or killed tab left behind.
export async function resumePending() {
  await ready;
  for (const note of listNotes()) {
    if (note.status === "recording") {
      // The recorder saves every few seconds: keep what was captured.
      await updateNote(note.id, { status: "recorded" });
    } else if (note.status === "sending") {
      // The response was lost; the user decides whether to send again.
      await updateNote(note.id, { status: "send-failed", error: "Envoi interrompu" });
    }
  }
  for (const note of listNotes()) {
    // An outage may be over: what it put aside is tried again at each launch.
    const waiting = note.status === "recorded" || note.status === "transcribing" || (note.status === "transcription-failed" && note.outage);
    if (!note.transcript && waiting) {
      void transcribeNote(note.id);
    }
  }
}
