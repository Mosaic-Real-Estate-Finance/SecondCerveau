// The dictation's audio as the transcription service hears it: 16 kHz mono
// PCM, taken off the live graph while the user speaks and handed on as a
// continuous stream, a quarter of a second at a time.
//
// The recorder still produces its own mp4 file, which is what is kept. This
// is the second, live copy of the same sound, and the only one streamed.
//
// Three decisions, two of them learned from an iPhone:
//
// - The context keeps the hardware's own sample rate. Asking a *realtime*
//   AudioContext for 16 kHz and then hanging a microphone off it is not
//   something WebKit is happy to do, and an iPhone answered it by killing
//   the tab the instant a recording began. The samples are resampled
//   instead, batch by batch, through an OfflineAudioContext at 16 kHz — the
//   same machinery the app uses to decode a recording, so it is known to
//   work on the device.
// - The context is created per recording, inside the gesture that starts it,
//   and closed with it. Safari is particular about when an audio graph may
//   come to life, and this is the shape that has always worked here.
// - The capture runs in an AudioWorklet, on the audio thread. A
//   ScriptProcessor would drop samples whenever the main thread is busy,
//   which during a recording with a running animation is often. Its output
//   goes nowhere: see the note at the connection.

/** The stream's sample rate. What leaves this module is always at this rate. */
const RATE = 16000;

/** Samples per message from the audio thread — about 85 ms at 48 kHz. */
const BLOCK = 4096;

/**
 * Seconds per batch handed on. Short enough for the text to keep up with the
 * voice, long enough not to build an offline context a dozen times a second.
 */
const BATCH_S = 0.25;

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

// ---- Resampling -------------------------------------------------------------

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

const join = (blocks: Float32Array[]) => {
  const out = new Float32Array(blocks.reduce((sum, block) => sum + block.length, 0));
  let at = 0;
  for (const block of blocks) {
    out.set(block, at);
    at += block.length;
  }
  return out;
};

// ---- The capture itself ---------------------------------------------------

export type Capture = {
  /** Stops capturing, after handing on whatever was still in the batch. */
  end(): Promise<void>;
  /** Drops everything; for an abandoned recording. */
  abort(): void;
  /** On hold nothing is captured. */
  setPaused(paused: boolean): void;
  /**
   * Seconds of sound that actually reached the processor. Compared against
   * the recording's own length it says whether the live transcript covers
   * the whole dictation: on iOS the audio graph can be interrupted — a call
   * coming in — and a text missing its middle would be far worse than one
   * that took longer to arrive.
   */
  seconds(): number;
};

/**
 * Taps `source` and calls `onPcm` with the sound, in order, at 16 kHz.
 * Resolves null when this browser has no live path, which is not an error:
 * the caller then transcribes the recording at the end.
 *
 * Call it after the recorder is already running. Registering the processor
 * costs a few milliseconds and they must not be taken out of the recording.
 */
export async function startCapture(
  source: AudioNode,
  onPcm: (pcm: Float32Array) => void,
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
  // stop pulling it, no samples arrive, the coverage check sees it and the
  // recording is transcribed whole at the end.
  source.connect(node);

  const rate = ctx.sampleRate;
  const perBatch = Math.ceil((BATCH_S * rate) / BLOCK);
  let pending: Float32Array[] = [];
  let paused = false;
  let closed = false;
  let heard = 0;
  // Resampling is asynchronous, and the stream must stay in order: batches
  // are handed on one after the other, never racing.
  let chain: Promise<unknown> = Promise.resolve();

  const hand = () => {
    if (!pending.length) return chain;
    const batch = join(pending);
    pending = [];
    chain = chain.then(() => to16k(batch, rate).then(onPcm, () => undefined));
    return chain;
  };

  node.port.onmessage = (event: MessageEvent<Float32Array>) => {
    if (paused || closed) return;
    heard += event.data.length;
    pending.push(event.data);
    if (pending.length >= perBatch) void hand();
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
      if (closed) return;
      disconnect();
      await hand();
    },
    abort() {
      pending = [];
      disconnect();
    },
    setPaused(next: boolean) {
      if (next === paused || closed) return;
      paused = next;
      // What was said up to the pause goes now, not after it.
      if (next) void hand();
    },
  };
}
