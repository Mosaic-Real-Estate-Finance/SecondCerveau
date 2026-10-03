/// <reference lib="webworker" />
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

// Whisper runs here so the UI thread stays free while the user picks a contact.

// webkit: Safari on macOS, any browser on iOS. Detected on the main thread,
// where navigator.vendor exists (it does not in workers). `threads` likewise:
// the budget depends on navigator.hardwareConcurrency and crossOriginIsolated.
export type Engine = { model: string; webkit: boolean; threads: number };

export type WorkerRequest =
  // Loads the weights into memory and nothing else. Sent when a dictation
  // starts, so the session is up before there is anything to transcribe.
  | { type: "warm"; engine: Engine }
  | { type: "transcribe"; id: string; engine: Engine; audio: Float32Array };

export type WorkerResponse =
  | { type: "ready" }
  | { type: "result"; id: string; text: string; seconds: number }
  | { type: "error"; id: string; message: string; loading: boolean };

env.allowLocalModels = false;

// Plain WASM build, served from our origin (scripts/copy-ort.mjs). Left alone,
// Transformers.js loads the asyncify build, which on Safari 26 triggers a
// WebKit bug where WASM compilation memory grows until iOS kills the tab.
// https://github.com/microsoft/onnxruntime/issues/26827
// https://github.com/huggingface/transformers.js/issues/1242
const wasm = env.backends.onnx.wasm!;
wasm.wasmPaths = {
  mjs: new URL("/ort/ort-wasm-simd-threaded.mjs", self.location.origin).href,
  wasm: new URL("/ort/ort-wasm-simd-threaded.wasm", self.location.origin).href,
};

let loading: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function load(engine: Engine) {
  // Threads are where the time is. Measured on the same machine, one pass over
  // a 30 s window: 16.4 s on one thread, 9.9 s on two, 6.6 s on four. The main
  // thread decides the budget (see transcriber.ts) and drops it if a session
  // ever fails to come up.
  wasm.numThreads = engine.threads;
  loading ??= pipeline("automatic-speech-recognition", engine.model, {
    // q8 forced: Transformers.js would otherwise pick its own default per device.
    dtype: "q8",
    device: "wasm",
    session_options: engine.webkit
      ? {
          // Peak memory over speed: no preallocated arenas, no prepacked copy
          // of the int8 weights.
          enableCpuMemArena: false,
          enableMemPattern: false,
          extra: { session: { disable_prepacking: "1" } },
        }
      : undefined,
  });
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

const describe = (error: unknown) => String((error as Error)?.message ?? error);

// Whisper decodes a long utterance in several of its own segments and the
// pipeline concatenates them as they come, which now and then loses the
// space between two sentences — "signé vendredi dernier.Le montant global".
// The rule only fires between a lowercase letter or a digit and a capital,
// so an abbreviation like « T.V.A. » is left alone.
const tidy = (text: string) =>
  text
    .replace(/([a-zà-öø-ÿ0-9][.!?…])([A-ZÀ-ÖØ-Þ])/g, "$1 $2")
    .replace(/[^\S\n]+/g, " ")
    .trim();

self.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const id = request.type === "transcribe" ? request.id : "warm";
  let asr: AutomaticSpeechRecognitionPipeline;
  try {
    asr = await load(request.engine);
    self.postMessage({ type: "ready" } satisfies WorkerResponse);
  } catch (error) {
    self.postMessage({ type: "error", id, message: describe(error), loading: true } satisfies WorkerResponse);
    return;
  }
  if (request.type === "warm") return;
  try {
    const started = performance.now();
    // Whisper hears 30 s at a time. Anything longer is cut into overlapping
    // windows and stitched back together on the token timestamps — which is
    // also where the stitching artefacts come from, duplicated words and
    // missing spaces at the seams. A dictation transcribed as it is spoken
    // arrives in utterances shorter than that, so it is passed whole and
    // there is no seam to stitch.
    const window = 30 * 16000;
    const output = await asr(request.audio, {
      language: "french",
      task: "transcribe",
      ...(request.audio.length > window ? { chunk_length_s: 30, stride_length_s: 5 } : {}),
    });
    const text = tidy(Array.isArray(output) ? output.map((part) => part.text).join(" ") : output.text);
    self.postMessage({
      type: "result",
      id: request.id,
      text,
      seconds: (performance.now() - started) / 1000,
    } satisfies WorkerResponse);
  } catch (error) {
    self.postMessage({ type: "error", id: request.id, message: describe(error), loading: false } satisfies WorkerResponse);
  }
});
