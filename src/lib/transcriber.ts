import { useSyncExternalStore } from "react";
import type { Engine, WorkerRequest, WorkerResponse } from "@/workers/whisper.worker";

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

type Job = { resolve: (value: { text: string; seconds: number }) => void; reject: (error: Error) => void };
const jobs = new Map<string, Job>();
let worker: Worker | null = null;

// WASM memory never shrinks; ending the worker is the only way to give it back.
function stopWorker() {
  worker?.terminate();
  worker = null;
}

function getWorker() {
  if (worker) return worker;
  const current = new Worker(new URL("../workers/whisper.worker.ts", import.meta.url), { type: "module" });
  worker = current;
  current.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    if (message.type === "ready") {
      setState({ status: "ready", error: undefined });
      return;
    }
    const job = jobs.get(message.id);
    jobs.delete(message.id);
    if (message.type === "result") return job?.resolve({ text: message.text, seconds: message.seconds });
    if (message.loading) {
      stopWorker();
      // A session that will not come up is, far more often than not, the
      // thread pool: no SharedArrayBuffer, or not enough room for it. The
      // budget drops and the next attempt rebuilds the worker on fewer.
      const retrying = fewerThreads();
      setState({
        status: "cached",
        error: retrying ? undefined : `chargement du modèle : ${message.message}`,
      });
    }
    job?.reject(new Error(message.message));
  });
  // The worker died (out of memory) without the tab.
  current.addEventListener("error", () => {
    stopWorker();
    fewerThreads();
    jobs.forEach((job) => job.reject(new Error("Le moteur de transcription s'est arrêté")));
    jobs.clear();
    setState({ status: "cached" });
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
      setState({ status: "absent", loaded: 0, total: 0, error: `téléchargement : ${(error as Error).message}` });
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
    if (state.status !== "cached") throw new Error(`fetch: ${state.error ?? "modèle non téléchargé"}`);
  }
  return new Promise<{ text: string; seconds: number }>((resolve, reject) => {
    jobs.set(id, { resolve, reject });
    if (state.status !== "ready") setState({ status: "loading" });
    const request: WorkerRequest = { type: "transcribe", id, engine: ENGINE, audio };
    getWorker().postMessage(request, [audio.buffer]);
  });
}
