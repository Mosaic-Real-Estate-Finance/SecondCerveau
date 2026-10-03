// Copies the plain (non asyncify, non JSEP) ONNX Runtime WASM build into
// public/ort, served from our own origin.
//
// Transformers.js picks the asyncify build on Safari 26, which hits a WebKit
// bug where WASM compilation memory runs away until iOS kills the tab:
// https://github.com/microsoft/onnxruntime/issues/26827
// https://bugs.webkit.org/show_bug.cgi?id=304810
// The documented workaround is to point wasmPaths at the plain build.
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const from = (file) => fileURLToPath(new URL(`../node_modules/onnxruntime-web/dist/${file}`, import.meta.url));
const to = (file) => fileURLToPath(new URL(`../public/ort/${file}`, import.meta.url));

await mkdir(to(""), { recursive: true });
for (const file of ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]) await copyFile(from(file), to(file));
console.log("ort: plain WASM build copied to public/ort");
