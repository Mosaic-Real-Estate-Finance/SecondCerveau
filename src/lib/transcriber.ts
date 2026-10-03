import { useSyncExternalStore } from "react";
import type { Engine, Stage, WorkerRequest, WorkerResponse } from "@/workers/whisper.worker";

const MODEL = import.meta.env.VITE_WHISPER_MODEL || "onnx-community/whisper-small-cv11-french-ONNX";

// Safari on macOS, and every browser on iOS (all of them run WebKit there).
const isWebKit =
  typeof navigator !== "undefined" &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1) ||
    (navigator.vendor === "Apple Computer, Inc." && !/Chrome|Chromium|Firefox/.test(navigator.userAgent)));

// Earlier builds remembered failed engines here; that state hid the download
// button for good, so it is cleared once.
try {
  localStorage.removeItem("mosaic-asr-failed");
  localStorage.removeItem("mosaic-asr-attempt");
} catch {
  // No storage: nothing to clear.
}

// ---- Threads ----------------------------------------------------------------
// The single biggest cost between the last word and the transcript is the
// inference itself, and it parallelises. One pass over a 30 s window, same
// machine: 16.4 s on one thread, 9.9 s on two, 6.6 s on four.
//
// It needs SharedArrayBuffer, which only exists on a cross-origin isolated
// page — public/_headers and the Vite config send COOP and COEP for that.
// Without isolation the runtime falls back to one thread on its own, and the
// budget below says so rather than asking for threads it cannot have.
//
// Half the cores, at most four: an iPhone reports six (two performance, four
// efficiency), and the recorder, the glow and the page still need a core
// while a dictation is being transcribed as it is spoken.

const THREADS_KEY = "mosaic-asr-threads";

const ceiling = () => {
  if (typeof SharedArrayBuffer === "undefined" || !globalThis.crossOriginIsolated) return 1;
  // Not on WebKit. A threaded WASM module has to reserve its memory up
  // front, and on an iPhone that reservation is answered by the tab being
  // killed the moment a recording starts. Playwright's WebKit runs it
  // happily on a desktop with desktop memory, which is exactly why that
  // measurement was worth nothing here.
  if (isWebKit) return 1;
  return Math.min(4, Math.max(1, Math.ceil((navigator.hardwareConcurrency || 2) / 2)));
};

// A phone that could not bring a threaded session up keeps the lower number,
// so it is paid once rather than on every dictation.
function remembered() {
  try {
    const saved = Number(localStorage.getItem(THREADS_KEY));
    return Number.isFinite(saved) && saved >= 1 ? Math.min(saved, ceiling()) : ceiling();
  } catch {
    return ceiling();
  }
}

const ENGINE: Engine = { model: MODEL, webkit: isWebKit, threads: remembered() };

/** Called when a session will not start: halve the budget and keep it. */
function fewerThreads() {
  if (ENGINE.threads <= 1) return false;
  ENGINE.threads = Math.max(1, Math.floor(ENGINE.threads / 2));
  try {
    localStorage.setItem(THREADS_KEY, String(ENGINE.threads));
  } catch {
    // The budget then falls back to the ceiling on the next launch.
  }
  return true;
}

// ---- Weights ----------------------------------------------------------------
// Transformers.js reads each file whole into memory and copies it into the
// cache while loading both at once. The two large files are fetched here
// instead, one after the other and streamed straight to Cache Storage, under
// the exact keys Transformers.js looks up; it then only reads them back.

const CACHE = "transformers-cache";
const WEIGHTS = ["onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"];
const weightURL = (file: string) => `https://huggingface.co/${MODEL}/resolve/main/${file}`;

// Once true it stays true: nothing here deletes the weights, and this is now
// asked once per utterance of a dictation rather than once per note.
let cached = false;

async function weightsCached() {
  if (cached) return true;
  if (!("caches" in self)) return false;
  const cache = await caches.open(CACHE);
  const hits = await Promise.all(WEIGHTS.map((file) => cache.match(weightURL(file))));
  cached = hits.every(Boolean);
  return cached;
}

async function weightSizes(): Promise<Record<string, number>> {
  try {
    const response = await fetch(`https://huggingface.co/api/models/${MODEL}/tree/main/onnx`);
    const entries: { path: string; size: number }[] = await response.json();
    return Object.fromEntries(entries.map((entry) => [entry.path, entry.size]));
  } catch {
    return {};
  }
}

let downloading: Promise<void> | null = null;

function downloadWeights() {
  downloading ??= (async () => {
    setState({ status: "downloading", loaded: 0, total: 0, error: undefined });
    const cache = await caches.open(CACHE);
    const sizes = await weightSizes();
    const total = WEIGHTS.reduce((sum, file) => sum + (sizes[file] ?? 0), 0);
    let loaded = 0;
    let lastReport = 0;
    setState({ status: "downloading", loaded, total, error: undefined });

    for (const file of WEIGHTS) {
      const url = weightURL(file);
      if (await cache.match(url)) {
        loaded += sizes[file] ?? 0;
        continue;
      }
      const response = await fetch(url);
      if (!response.ok || !response.body) throw new Error(`réponse ${response.status} de Hugging Face`);
      const reader = response.body.getReader();
      const counted = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const { done, value } = await reader.read();
          if (done) return controller.close();
          loaded += value.byteLength;
          // A chunk arrives every few milliseconds; the bar needs four
          // updates a second, not hundreds of re-renders during a dictation.
          const now = performance.now();
          if (now - lastReport > 250) {
            lastReport = now;
            setState({ loaded, total: Math.max(total, loaded) });
          }
          controller.enqueue(value);
        },
        cancel: (reason) => reader.cancel(reason),
      });
      const headers = new Headers({ "Content-Type": "application/octet-stream" });
      if (sizes[file]) headers.set("Content-Length", String(sizes[file]));
      await cache.put(url, new Response(counted, { headers }));
    }
  })().finally(() => {
    downloading = null;
  });
  return downloading;
}

// ---- Naming the step that failed -------------------------------------------
// Three things can go wrong and they are not the same problem at all: the
// weights never arrive, the session never comes up, or the pass itself fails.
// "Erreur inattendue" sent the reader nowhere; the step at least says whether
// to look at the network, the machine or the recording.

export type EngineStage = "download" | Stage;

const STEP: Record<EngineStage, string> = {
  download: "téléchargement du modèle",
  model: "chargement du modèle",
  inference: "transcription",
};

export class EngineError extends Error {
  constructor(
    readonly stage: EngineStage,
    message: string,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

/** "chargement du modèle : plus de mémoire" — the step, then the cause. */
export const stepOf = (stage: EngineStage) => STEP[stage];

// ---- State ------------------------------------------------------------------

export type ModelState = {
  // cached: weights on the phone, not in memory. ready: loaded in memory.
  status: "unknown" | "absent" | "downloading" | "cached" | "loading" | "ready";
  loaded: number;
  total: number;
  error?: string;
};

let state: ModelState = { status: "unknown", loaded: 0, total: 0 };
const listeners = new Set<() => void>();
function setState(patch: Partial<ModelState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function useModelState() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

// ---- Worker -----------------------------------------------------------------

// A worker that stops takes the utterance with it, and the user did not ask
// twice. Each job therefore keeps its own copy of the audio so it can be sent
// again to a rebuilt worker — about 2 MB for a full 30 s window, against the
// 406 MB of weights already resident, and the alternative is a dictation lost
// to a worker that died for a reason the next one will not hit.
type Job = {
  resolve: (value: { text: string; seconds: number }) => void;
  reject: (error: Error) => void;
  audio: Float32Array;
  attempts: number;
  watchdog: number;
};

/** One replay. A second failure is a real failure, not a hiccup. */
const MAX_ATTEMPTS = 2;

// A worker can also stop without saying anything — killed by the system, or
// wedged inside the runtime. No event fires then, and the dictation simply
// never comes back. These turn that silence into a restart, and eventually
// into a message.
//
// Two budgets, because the two phases are not remotely alike. Reading 406 MB
// back and building both ONNX graphs is slow on a cold machine; a pass on a
// session already up is seconds. A single budget would have to be the larger
// one, and a wedged engine would then sit silent for three minutes before
// saying anything — and three more for the retry. The worker announces
// `ready` between the two, so there is no need to guess.
//
// Measured: a cold load that was given 6 s failed on a session that was
// merely slow, which is the worse bug of the two. Both numbers are several
// times the observed worst case.
const LOAD_MS = 180_000;
const PASS_MS = 60_000;

/** True once this worker has a session up. Reset whenever it is replaced. */
let sessionReady = false;

const jobs = new Map<string, Job>();
let worker: Worker | null = null;

// WASM memory never shrinks; ending the worker is the only way to give it back.
function stopWorker() {
  worker?.terminate();
  worker = null;
  sessionReady = false;
}

function settle(id: string) {
  const job = jobs.get(id);
  if (job) clearTimeout(job.watchdog);
  jobs.delete(id);
  return job;
}

/** Sends a job to the worker, building one if there is none. */
function arm(id: string, job: Job) {
  clearTimeout(job.watchdog);
  job.watchdog = window.setTimeout(() => expired(id), sessionReady ? PASS_MS : LOAD_MS);
}

function dispatch(id: string, job: Job) {
  arm(id, job);
  // The copy travels, the original stays: a transferred buffer is detached on
  // this side, and a replay would have nothing left to send.
  const audio = job.audio.slice();
  getWorker().postMessage({ type: "transcribe", id, engine: ENGINE, audio } satisfies WorkerRequest, [audio.buffer]);
}

/**
 * Sends the job again, on a fresh worker when the session is the suspect.
 * Returns false when the job has already had its retry, which is the caller's
 * signal to give up out loud.
 *
 * `rebuild` is not free: a new worker re-reads 406 MB of weights and rebuilds
 * both ONNX graphs. Worth it when the session died or never came up, wasteful
 * after a single failed pass on a session that is demonstrably alive.
 */
function retry(id: string, rebuild: boolean): boolean {
  const job = jobs.get(id);
  if (!job || job.attempts >= MAX_ATTEMPTS) return false;
  job.attempts++;
  if (rebuild) {
    stopWorker();
    setState({ status: "loading", error: undefined });
  }
  dispatch(id, job);
  return true;
}

function expired(id: string) {
  const job = jobs.get(id);
  if (!job) return;
  if (retry(id, true)) return;
  settle(id)?.reject(new EngineError("model", "le moteur n'a pas répondu"));
  stopWorker();
  setState({ status: "cached", error: `${stepOf("model")} : le moteur n'a pas répondu` });
}

function getWorker() {
  if (worker) return worker;
  const current = new Worker(new URL("../workers/whisper.worker.ts", import.meta.url), { type: "module" });
  worker = current;
  current.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    if (message.type === "ready") {
      // The slow half is over: anything still waiting is now waiting on a
      // pass, and gets the shorter budget.
      sessionReady = true;
      for (const [id, job] of jobs) arm(id, job);
      setState({ status: "ready", error: undefined });
      return;
    }
    if (message.type === "result") {
      settle(message.id)?.resolve({ text: message.text, seconds: message.seconds });
      return;
    }

    if (message.stage === "model") {
      stopWorker();
      // A session that will not come up is, far more often than not, the
      // thread pool: no SharedArrayBuffer, or not enough room for it. The
      // budget drops and the next attempt rebuilds the worker on fewer.
      const fewer = fewerThreads();
      // Fewer threads, or simply once more on a fresh worker: either way the
      // utterance is sent again rather than lost.
      if (retry(message.id, true)) return;
      settle(message.id)?.reject(new EngineError("model", message.message));
      setState({
        status: "cached",
        error: fewer ? undefined : `${stepOf("model")} : ${message.message}`,
      });
      return;
    }

    // The pass itself failed. The session is up, so it is kept — one more
    // pass costs seconds, a rebuild costs the whole model again.
    if (retry(message.id, false)) return;
    settle(message.id)?.reject(new EngineError("inference", message.message));
    setState({ status: "ready", error: `${stepOf("inference")} : ${message.message}` });
  });

  // The worker died — out of memory, or taken by the system — without the tab
  // noticing. Everything still in flight is sent to a fresh one.
  current.addEventListener("error", () => {
    stopWorker();
    fewerThreads();
    for (const id of [...jobs.keys()]) {
      if (retry(id, true)) continue;
      settle(id)?.reject(new EngineError("model", "le moteur de transcription s'est arrêté"));
      setState({ status: "cached", error: `${stepOf("model")} : le moteur s'est arrêté` });
    }
  });
  return current;
}

// ---- API --------------------------------------------------------------------

// Only reports whether the weights are on the device. Loading them into memory
// waits for a transcription.
export async function checkModelCached() {
  try {
    const cached = await weightsCached();
    if (state.status === "unknown" || state.status === "absent") setState({ status: cached ? "cached" : "absent" });
  } catch {
    setState({ status: "absent" });
  }
}

// Download only, nothing goes into memory. Started at launch; a dictation made
// meanwhile waits on the same promise instead of failing.
let preparing: Promise<void> | null = null;

export function preloadModel() {
  preparing ??= (async () => {
    try {
      if (!(await weightsCached())) await downloadWeights();
      setState({ status: "cached", error: undefined });
    } catch (error) {
      setState({
        status: "absent",
        loaded: 0,
        total: 0,
        error: `${stepOf("download")} : ${(error as Error).message}`,
      });
    }
  })().finally(() => {
    preparing = null;
  });
  return preparing;
}

/**
 * Brings the session up before there is anything to transcribe.
 *
 * Reading 406 MB of weights back and building the two ONNX graphs is work
 * that used to start only once the user had stopped speaking, in front of an
 * empty screen. Started when the dictation starts, it happens while they
 * talk and costs nothing at all.
 *
 * Only ever called with the weights already on the device: it must not turn
 * a recording into a download.
 */
export async function warmEngine() {
  if (state.status === "ready" || state.status === "loading") return;
  if (!(await weightsCached())) return;
  setState({ status: "loading" });
  getWorker().postMessage({ type: "warm", engine: ENGINE } satisfies WorkerRequest);
}

export async function transcribe(id: string, audio: Float32Array) {
  if (!(await weightsCached())) {
    await preloadModel();
    if (state.status !== "cached") {
      throw new EngineError("download", state.error?.replace(/^[^:]+ : /, "") ?? "modèle non téléchargé");
    }
  }
  return new Promise<{ text: string; seconds: number }>((resolve, reject) => {
    // The audio stays here; dispatch sends a copy. See the note on Job.
    const job: Job = { resolve, reject, audio, attempts: 1, watchdog: 0 };
    jobs.set(id, job);
    if (state.status !== "ready") setState({ status: "loading" });
    dispatch(id, job);
  });
}
