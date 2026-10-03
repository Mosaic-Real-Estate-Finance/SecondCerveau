// Whisper's own input, captured while the dictation is still happening.
//
// The recorder produces an mp4 container; Whisper wants 16 kHz mono PCM.
// That conversion used to happen once, at the end, on the whole file — and
// so did the transcription, which is why the wait started only when the user
// stopped talking. Here the samples are taken off the live graph instead and
// cut into utterances at the silences between sentences, so each one can be
// transcribed while the next is being spoken.
//
// Three decisions, two of them learned from an iPhone:
//
// - The context keeps the hardware's own sample rate. Asking a *realtime*
//   AudioContext for 16 kHz and then hanging a microphone off it is not
//   something WebKit is happy to do, and an iPhone answered it by killing
//   the tab the instant a recording began. Each closed utterance is
//   resampled instead, through an OfflineAudioContext at 16 kHz — the same
//   machinery the app already uses to decode a recording, so it is known to
//   work on the device.
// - The context is created per recording, inside the gesture that starts it,
//   and closed with it. Safari is particular about when an audio graph may
//   come to life, and this is the shape that has always worked here.
// - The capture runs in an AudioWorklet, on the audio thread. A
//   ScriptProcessor would drop samples whenever the main thread is busy,
//   which during a recording with a running animation is often. Its output
//   goes nowhere: see the note at the connection.

/** Whisper's sample rate. What leaves this module is always at this rate. */
const RATE = 16000;

/** Samples per message from the audio thread — about 85 ms at 48 kHz. */
const BLOCK = 4096;

/** Never close an utterance shorter than this: one pass costs the same as 30 s. */
const MIN_S = 12;
/** Whisper's window is 30 s. Close before it, so nothing is ever truncated. */
const MAX_S = 27;
/** A silence this long is a sentence break, not a breath. */
const HOLD_S = 0.6;
/** Silence left at the end of an utterance, so the last word is not clipped. */
const KEEP_S = 0.25;
/** Below this there is no voice at all, whatever the room. */
const FLOOR = 0.008;
/** …and below this share of the loudest moment so far, there is none either. */
const RELATIVE = 0.12;

const PROCESSOR = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(${BLOCK});
    this.filled = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.filled++] = channel[i];
        if (this.filled === this.buffer.length) {
          this.port.postMessage(this.buffer, [this.buffer.buffer]);
          this.buffer = new Float32Array(${BLOCK});
          this.filled = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;

// ---- Resampling to what Whisper hears -------------------------------------

async function to16k(input: Float32Array, rate: number): Promise<Float32Array> {
  if (rate === RATE) return input;
  const length = Math.max(1, Math.round((input.length * RATE) / rate));
  const offline = new OfflineAudioContext(1, length, RATE);
  const buffer = offline.createBuffer(1, input.length, rate);
  buffer.getChannelData(0).set(input);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  return (await offline.startRendering()).getChannelData(0).slice();
}

// ---- Cutting the stream into utterances -----------------------------------

const rms = (block: Float32Array) => {
  let sum = 0;
  for (const sample of block) sum += sample * sample;
  return Math.sqrt(sum / block.length);
};

const join = (blocks: Float32Array[]) => {
  const out = new Float32Array(blocks.length * BLOCK);
  blocks.forEach((block, index) => out.set(block, index * BLOCK));
  return out;
};

function segmenter(blockSeconds: number) {
  let blocks: Float32Array[] = [];
  let levels: number[] = [];
  let peak = 0;

  const take = (count: number) => {
    const at = Math.min(Math.max(count, Math.ceil(MIN_S / blockSeconds)), blocks.length);
    const segment = join(blocks.slice(0, at));
    blocks = blocks.slice(at);
    levels = levels.slice(at);
    peak = levels.reduce((high, level) => Math.max(high, level), 0);
    return segment;
  };

  return {
    /** Returns a closed utterance when this block ends one. */
    push(block: Float32Array): Float32Array | null {
      const level = rms(block);
      blocks.push(block);
      levels.push(level);
      peak = Math.max(peak, level);
      const seconds = blocks.length * blockSeconds;
      if (seconds < MIN_S) return null;

      // Out of room: cut at the quietest moment of the last two seconds, so
      // the join lands between words rather than inside one.
      if (seconds >= MAX_S) {
        const from = Math.max(0, levels.length - Math.round(2 / blockSeconds));
        let quietest = levels.length - 1;
        for (let i = from; i < levels.length; i++) if (levels[i] < levels[quietest]) quietest = i;
        return take(quietest + 1);
      }

      // A sentence has ended: cut in the silence after it.
      const threshold = Math.max(FLOOR, peak * RELATIVE);
      let run = 0;
      while (run < levels.length && levels[levels.length - 1 - run] < threshold) run++;
      if (run * blockSeconds < HOLD_S) return null;
      return take(levels.length - run + Math.round(KEEP_S / blockSeconds));
    },

    /**
     * Everything not yet closed. `atLeast` guards against spending a whole
     * pass — they all cost what 30 s costs — on a fragment of silence.
     */
    flush(atLeast = 0.4): Float32Array | null {
      if (blocks.length * blockSeconds < atLeast) return null;
      const segment = join(blocks);
      blocks = [];
      levels = [];
      peak = 0;
      return segment;
    },
  };
}

// ---- The capture itself ---------------------------------------------------

export type Capture = {
  /** Stops capturing and hands back whatever utterance was still open. */
  end(): Promise<Float32Array | null>;
  /** Drops everything without a last utterance; for an abandoned recording. */
  abort(): void;
  /** On hold nothing is captured, and the pause itself closes an utterance. */
  setPaused(paused: boolean): void;
  /**
   * Seconds of sound that actually reached the processor. Compared against
   * the recording's own length it says whether the live transcript covers
   * the whole dictation: on iOS the audio graph can be interrupted — a call
   * coming in, the app backgrounded — and a text missing its middle would be
   * far worse than one that took longer to arrive.
   */
  seconds(): number;
};

/**
 * Taps `source` and calls `onSegment` with each closed utterance, at 16 kHz.
 * Resolves null when this browser has no live path, which is not an error:
 * the caller then transcribes the recording at the end, as it always did.
 *
 * Call it after the recorder is already running. Registering the processor
 * costs a few milliseconds and they must not be taken out of the recording.
 */
export async function startCapture(
  source: AudioNode,
  onSegment: (pcm: Float32Array) => void,
): Promise<Capture | null> {
  const ctx = source.context as AudioContext;
  let node: AudioWorkletNode;
  try {
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([PROCESSOR], { type: "text/javascript" })));
    node = new AudioWorkletNode(ctx, "pcm-capture", { numberOfOutputs: 1, outputChannelCount: [1] });
  } catch {
    return null;
  }
  // Nothing downstream. The usual advice is to connect a worklet to the
  // destination through a gain of zero, because a node whose output reaches
  // nothing may not be pulled — but measured in both engines the processor
  // runs either way (326 blocks against 324 in Chromium, 322 against 319 in
  // WebKit), and on iOS reaching the destination means reaching the system
  // audio session while the microphone is open. If some engine ever does
  // stop pulling it, no samples arrive, the coverage check below sees it and
  // the recording is transcribed whole at the end.
  source.connect(node);

  const rate = ctx.sampleRate;
  const cutter = segmenter(BLOCK / rate);
  let paused = false;
  let closed = false;
  let heard = 0;
  // Resampling is asynchronous, and the order of the utterances is the order
  // of the sentences: they are handed on one after the other, never racing.
  let chain: Promise<unknown> = Promise.resolve();

  const hand = (segment: Float32Array) => {
    chain = chain.then(() => to16k(segment, rate).then(onSegment, () => undefined));
    return chain;
  };

  node.port.onmessage = (event: MessageEvent<Float32Array>) => {
    if (paused || closed) return;
    heard += event.data.length;
    const segment = cutter.push(event.data);
    if (segment) void hand(segment);
  };

  const disconnect = () => {
    closed = true;
    node.port.onmessage = null;
    try {
      source.disconnect(node);
      node.disconnect();
    } catch {
      // Already torn down elsewhere.
    }
  };

  return {
    seconds: () => heard / rate,
    async end() {
      if (closed) return null;
      const tail = cutter.flush();
      disconnect();
      await chain;
      return tail ? to16k(tail, rate).catch(() => null) : null;
    },
    abort: disconnect,
    setPaused(next: boolean) {
      if (next === paused || closed) return;
      paused = next;
      // A pause is the clearest sentence break there is — worth a cut, but
      // only once there is half an utterance to send.
      if (next) {
        const segment = cutter.flush(MIN_S / 2);
        if (segment) void hand(segment);
      }
    },
  };
}
