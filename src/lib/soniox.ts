import { ApiError, fetchSttToken } from "./api";
import { VOCABULARY } from "./vocabulary";

// One dictation, streamed to Soniox while it is spoken.
// https://soniox.com/docs/stt/rt/real-time-transcription
//
// The text comes back as tokens. Non-final ones are a guess that may still
// change; final ones are sent once and never revised. What is shown is the
// final text so far followed by the current guess, rebuilt on every message.
//
// The hard part is not the protocol, it is the link. A WebSocket can stay
// "open" for seconds after anything stopped getting through, and iOS
// suspends the tab outright when the screen is locked or another app comes
// forward. Both look the same from here, and both are handled the same way:
//
// - The last seconds of PCM are kept. Every final token carries the time its
//   audio ends, so the stream always knows how far Soniox has really heard.
//   On reconnection a fresh session is opened and everything after that
//   point is sent again. Soniox has no way to resume a session; replaying
//   from the last final token makes one unnecessary, and no word is counted
//   twice.
// - When nothing comes back while audio goes out, the link is declared dead
//   without waiting for the socket to agree.
// - The stream says when it is down, and the recorder holds the recording
//   meanwhile: the buffer then only has to cover the few seconds it took to
//   notice. If it was not enough, the stream says so (`complete`), and the
//   dictation is transcribed again from the recording.

const RATE = 16000;
/** What the rolling buffer keeps that Soniox has not confirmed yet. */
const BUFFER_S = 30;
/** Silence sent before finalising, as Soniox recommends. */
const TAIL_S = 0.2;
/** No message for this long while audio is going out: the link is dead. */
const STALL_MS = 8000;
/** Soniox closes a stream after 20 s without audio or keepalive. */
const KEEPALIVE_MS = 8000;
/** Token, socket and configuration, all of it. */
const CONNECT_MS = 8000;
/** From « terminer » to the last final token, reconnections included. */
const FINISH_MS = 30000;
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000];
/** Bytes queued in the socket beyond which audio is no longer getting out. */
const CONGESTED_BYTES = 4 * RATE * 2;

export type StreamState = "connecting" | "live" | "down";

export class SttError extends Error {
  /**
   * True when no new attempt can succeed: the user is signed out, the server
   * has no key, Soniox refuses the request itself. False for a stream that
   * merely could not finish in time.
   */
  constructor(
    message: string,
    readonly lasting = false,
  ) {
    super(message);
  }
}

export type SonioxStream = {
  /** 16 kHz mono samples, in order. Buffered whatever the link is doing. */
  push(pcm: Float32Array): void;
  /** The tab is going away: let the socket go, keep the buffer. */
  suspend(): void;
  /** Back in front: reconnect now rather than at the next backoff. */
  resume(): void;
  /** Finalises and resolves the whole text. */
  finish(): Promise<string>;
  abort(): void;
  readonly state: StreamState;
  /** False once audio Soniox never confirmed fell out of the buffer. */
  readonly complete: boolean;
};

type Token = { text: string; is_final: boolean; end_ms?: number };
type Message = {
  tokens?: Token[];
  finished?: boolean;
  error_code?: number;
  error_type?: string;
  error_message?: string;
};

const toInt16 = (pcm: Float32Array) => {
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const sample = Math.max(-1, Math.min(1, pcm[i]));
    out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return out;
};

// Tokens carry their own spacing; only the two markers are not words.
const MARKERS = new Set(["<fin>", "<end>"]);
const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

export function openStream({
  onText,
  onState,
}: {
  onText: (text: string) => void;
  onState?: (state: StreamState) => void;
}): SonioxStream {
  // ---- Audio, by absolute sample index ----------------------------------
  let chunks: { at: number; pcm: Int16Array }[] = [];
  let total = 0;
  /** Up to here, Soniox has returned final text. */
  let heard = 0;
  let complete = true;

  // ---- Text --------------------------------------------------------------
  let final = "";
  let guess = "";

  // ---- Link --------------------------------------------------------------
  let socket: WebSocket | null = null;
  let state: StreamState = "connecting";
  /** Sample index the current session started at: its 0 ms. */
  let base = 0;
  let lastHeardFrom = 0;
  let lastAudio = 0;
  let lastSent = 0;
  let attempt = 0;
  let retry = 0;
  let connectTimer = 0;
  let suspended = false;
  let ended = false;
  let fatal: SttError | null = null;
  /** Identifies the connection attempt in flight; anything older is stale. */
  let current: object | null = null;

  // ---- Finishing -----------------------------------------------------------
  let finishing = false;
  let settle: { resolve: (text: string) => void; reject: (error: Error) => void } | null = null;

  const setState = (next: StreamState) => {
    if (next === state) return;
    state = next;
    onState?.(next);
  };

  const trim = () => {
    // Everything confirmed can go; the rest is kept up to BUFFER_S.
    while (chunks.length && chunks[0].at + chunks[0].pcm.length <= heard) chunks.shift();
    while (chunks.length && total - chunks[0].at > BUFFER_S * RATE) {
      chunks.shift();
      complete = false;
    }
  };

  const send = (data: string | BufferSource) => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(data);
    lastSent = performance.now();
  };

  const sendAudio = (pcm: Int16Array) => {
    // A copy of exactly these samples: a view into a larger buffer would send
    // the whole buffer.
    send(new Int16Array(pcm));
    lastAudio = lastSent;
  };

  const emit = () => onText(tidy(final + guess));

  const drop = () => {
    clearTimeout(connectTimer);
    if (!socket) return;
    const old = socket;
    socket = null;
    old.onopen = old.onmessage = old.onclose = old.onerror = null;
    try {
      old.close();
    } catch {
      // Already gone.
    }
  };

  const fail = (error: SttError) => {
    fatal = error;
    drop();
    setState("down");
    settle?.reject(error);
    settle = null;
  };

  // The link is gone or unusable: start over, from what Soniox confirmed.
  const lost = () => {
    current = null;
    drop();
    // What was only guessed will be heard again from the replay.
    guess = "";
    emit();
    if (ended || fatal) return;
    setState("down");
    if (suspended) return;
    clearTimeout(retry);
    retry = window.setTimeout(connect, BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
    attempt++;
  };

  const finalise = () => {
    // Silence first, so the last word is not cut at the edge of the audio.
    push(new Float32Array(Math.round(TAIL_S * RATE)));
    send(JSON.stringify({ type: "finalize" }));
  };

  const onMessage = (event: MessageEvent) => {
    lastHeardFrom = performance.now();
    let message: Message;
    try {
      message = JSON.parse(String(event.data)) as Message;
    } catch {
      return;
    }
    if (message.error_code) {
      // An expired or used key is not the user's problem: a new one is
      // minted on reconnection. Anything else in the 4xx is our request or
      // our account, which retrying will not change.
      const retriable =
        message.error_code >= 500 || message.error_code === 408 || message.error_type?.startsWith("temp_api_key");
      if (retriable) return lost();
      return fail(new SttError(`service de transcription : ${message.error_message ?? message.error_code}`, true));
    }
    let fin = false;
    guess = "";
    for (const token of message.tokens ?? []) {
      if (token.text === "<fin>") fin = true;
      if (MARKERS.has(token.text)) continue;
      if (token.is_final) {
        final += token.text;
        if (token.end_ms !== undefined) heard = Math.max(heard, base + Math.round((token.end_ms * RATE) / 1000));
      } else {
        guess += token.text;
      }
    }
    // Something came back on this session: the backoff starts over.
    attempt = 0;
    trim();
    emit();
    if (fin && finishing) {
      // Everything is final. Closing the stream properly is a courtesy; the
      // text no longer depends on it.
      send("");
      ended = true;
      drop();
      settle?.resolve(tidy(final));
      settle = null;
    }
  };

  async function connect() {
    if (ended || fatal || suspended) return;
    drop();
    const mine = {};
    current = mine;
    connectTimer = window.setTimeout(() => current === mine && lost(), CONNECT_MS);
    let token;
    try {
      token = await fetchSttToken();
    } catch (error) {
      if (current !== mine) return;
      if (error instanceof ApiError && (error.status === 401 || error.status === 500)) {
        return fail(new SttError(error.message, true));
      }
      return lost();
    }
    if (current !== mine || ended || suspended) return;
    // The key travels as a subprotocol: a browser cannot set headers on a
    // WebSocket, and the key in the first message is deprecated.
    // https://soniox.com/docs/guides/websocket-authentication
    const ws = new WebSocket(token.wsUrl, ["soniox-api-key", token.apiKey]);
    ws.binaryType = "arraybuffer";
    socket = ws;
    ws.onopen = () => {
      clearTimeout(connectTimer);
      send(
        JSON.stringify({
          model: token.model,
          audio_format: "pcm_s16le",
          sample_rate: RATE,
          num_channels: 1,
          language_hints: ["fr"],
          context: {
            general: [{ key: "domain", value: "Financement immobilier" }],
            terms: VOCABULARY,
          },
        }),
      );
      // The session starts at the first sample not yet confirmed. If the
      // buffer no longer reaches back that far, it starts where it can and
      // the dictation is marked incomplete.
      trim();
      base = chunks.length ? Math.max(heard, chunks[0].at) : total;
      if (chunks.length && chunks[0].at > heard) complete = false;
      for (const chunk of chunks) {
        const skip = Math.max(0, base - chunk.at);
        if (skip < chunk.pcm.length) sendAudio(chunk.pcm.subarray(skip));
      }
      lastHeardFrom = performance.now();
      setState("live");
      if (finishing) finalise();
    };
    ws.onmessage = onMessage;
    ws.onerror = () => lost();
    ws.onclose = () => lost();
  }

  function push(pcm: Float32Array) {
    if (ended) return;
    const samples = toInt16(pcm);
    chunks.push({ at: total, pcm: samples });
    total += samples.length;
    trim();
    if (state === "live") sendAudio(samples);
  }

  // One clock for the stall check and the keepalive.
  const watch = window.setInterval(() => {
    if (state !== "live" || !socket) return;
    const now = performance.now();
    // Audio went out and nothing came back. A pause sends no audio, only
    // keepalives, which Soniox does not answer: those prove nothing.
    const silentServer = now - lastHeardFrom > STALL_MS && lastAudio > lastHeardFrom;
    const congested = socket.bufferedAmount > CONGESTED_BYTES;
    if (silentServer || congested) return lost();
    if (now - lastSent > KEEPALIVE_MS) send(JSON.stringify({ type: "keepalive" }));
  }, 1000);

  // The phone says the network is gone before the socket does.
  const offline = () => state !== "down" && lost();
  const online = () => {
    if (state !== "down" || suspended) return;
    clearTimeout(retry);
    attempt = 0;
    void connect();
  };
  window.addEventListener("offline", offline);
  window.addEventListener("online", online);

  const close = () => {
    ended = true;
    clearInterval(watch);
    clearTimeout(retry);
    window.removeEventListener("offline", offline);
    window.removeEventListener("online", online);
    drop();
  };

  void connect();

  return {
    push,
    suspend() {
      suspended = true;
      clearTimeout(retry);
      if (socket || state !== "down") {
        drop();
        guess = "";
        emit();
        setState("down");
      }
    },
    resume() {
      if (!suspended && state !== "down") return;
      suspended = false;
      clearTimeout(retry);
      attempt = 0;
      void connect();
    },
    finish() {
      if (fatal) return Promise.reject(fatal);
      if (ended) return Promise.resolve(tidy(final));
      finishing = true;
      // Even a suspended stream is finished: « terminer » means now.
      if (suspended) {
        suspended = false;
        void connect();
      } else if (state === "live") finalise();
      return new Promise<string>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          settle = null;
          close();
          reject(new SttError("le service de transcription n'a pas répondu à temps"));
        }, FINISH_MS);
        settle = {
          resolve: (text) => {
            clearTimeout(timer);
            close();
            resolve(text);
          },
          reject: (error) => {
            clearTimeout(timer);
            close();
            reject(error);
          },
        };
      });
    },
    abort: close,
    get state() {
      return state;
    },
    get complete() {
      return complete;
    },
  };
}
