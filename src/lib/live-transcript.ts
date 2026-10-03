import { transcribe } from "./transcriber";

// A dictation transcribed as it is spoken.
//
// The recorder cuts the live audio into utterances (see audio-capture.ts) and
// hands them here one at a time. Each is sent to the Whisper worker straight
// away, so the passes happen during the dictation instead of after it; when
// the user stops, only the last utterance is left to do.
//
// Two rules keep this from ever costing a dictation:
//
// - It is an optimisation, never the record. The audio is stored exactly as
//   before, and anything that goes wrong here — a failed pass, a worker that
//   died, a browser with no live path — simply abandons the attempt and
//   leaves the whole file to be transcribed at the end, as it always was.
// - The utterances are serialised. Whisper on WASM is one session; two
//   passes at once would only queue inside it, and the order of the text
//   matters.

type Live = {
  /** Resolved text per utterance, in order. */
  parts: string[];
  /** Tail of the chain: every utterance waits for the one before it. */
  queue: Promise<void>;
  count: number;
  /** Set by anything that makes the joined text less than the whole. */
  broken: boolean;
};

const sessions = new Map<string, Live>();

const listeners = new Set<(id: string, text: string) => void>();

/** Notified with the text so far, each time an utterance comes back. */
export function onPartial(listener: (id: string, text: string) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const joined = (live: Live) => live.parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

/** Opens a live transcript for a recording about to start. */
export function beginLive(id: string) {
  sessions.set(id, { parts: [], queue: Promise.resolve(), count: 0, broken: false });
}

/** Gives up on the live path for this recording; the whole file will do it. */
export function abandonLive(id: string) {
  const live = sessions.get(id);
  if (live) live.broken = true;
  sessions.delete(id);
}

/** Queues one closed utterance. Never rejects, never blocks the caller. */
export function pushSegment(id: string, pcm: Float32Array) {
  const live = sessions.get(id);
  if (!live || live.broken) return;
  const slot = live.count++;
  live.queue = live.queue.then(async () => {
    if (live.broken) return;
    try {
      const { text } = await transcribe(`${id}#${slot}`, pcm);
      live.parts[slot] = text.trim();
      const so_far = joined(live);
      if (so_far) listeners.forEach((listener) => listener(id, so_far));
    } catch {
      // One bad pass and the text would be missing a sentence in the middle,
      // which is worse than waiting: the whole file is transcribed instead.
      live.broken = true;
    }
  });
}

/**
 * Waits for everything queued and hands back the dictation's text, or null
 * when the live path did not carry all of it.
 */
export async function collectLive(id: string): Promise<string | null> {
  const live = sessions.get(id);
  sessions.delete(id);
  if (!live) return null;
  await live.queue;
  if (live.broken) return null;
  return joined(live) || null;
}
