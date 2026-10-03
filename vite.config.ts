import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// Cross origin isolation unlocks SharedArrayBuffer, which ONNX Runtime needs to
// run the WASM backend on several threads. Same values as public/_headers.
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

// Runs the Cloudflare Pages Functions in the Vite dev server, so the app talks
// to the exact same handlers locally and in production.
function pagesFunctions(env: Record<string, string>): Plugin {
  const routes: Record<string, { file: string; name: string }> = {
    "GET /api/contacts": { file: "/functions/api/contacts.ts", name: "onRequestGet" },
    "POST /api/contacts": { file: "/functions/api/contacts.ts", name: "onRequestPost" },
    "GET /api/companies": { file: "/functions/api/companies.ts", name: "onRequestGet" },
    "POST /api/companies": { file: "/functions/api/companies.ts", name: "onRequestPost" },
    "POST /api/session": { file: "/functions/api/session.ts", name: "onRequestPost" },
    "POST /api/notes": { file: "/functions/api/notes.ts", name: "onRequestPost" },
    "POST /api/files": { file: "/functions/api/files.ts", name: "onRequestPost" },
  };
  return {
    name: "pages-functions",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split("?")[0] ?? "";
        if (!path.startsWith("/api/")) return next();
        const route = routes[`${req.method} ${path}`];
        if (!route) {
          res.statusCode = 405;
          return res.end();
        }
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          // Over HTTPS the dev server speaks HTTP/2: drop its pseudo headers
          // (":method", ":path") and the symbol keys node adds.
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (key.startsWith(":") || value === undefined) continue;
            headers.set(key, Array.isArray(value) ? value.join(", ") : value);
          }
          const request = new Request(`http://localhost${req.url}`, {
            method: req.method,
            headers,
            body: chunks.length ? Buffer.concat(chunks) : undefined,
          });
          const module = await server.ssrLoadModule(route.file);
          const response: Response = await module[route.name]({ request, env });
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          server.config.logger.error(`[api] ${(error as Error).message}`);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Erreur du serveur local", retry: true }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    server: { headers: isolation },
    preview: { headers: isolation },
    worker: { format: "es" },
    optimizeDeps: { exclude: ["@huggingface/transformers"] },
    plugins: [
      // `npm run dev:mobile`: HTTPS on the local network with a self-signed
      // certificate, because iOS only opens the microphone on a secure origin.
      mode === "mobile" && basicSsl({ name: "mosaic-dictee" }),
      react(),
      tailwindcss(),
      pagesFunctions(env),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["favicon.svg", "apple-touch-icon.png"],
        manifest: {
          name: "Mosaic Dictée",
          short_name: "Dictée",
          description: "Dictée vocale vers la base de notes Notion.",
          lang: "fr",
          start_url: "/",
          display: "standalone",
          orientation: "portrait",
          background_color: "#ffffff",
          theme_color: "#ffffff",
          icons: [
            { src: "icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "icon-512.png", sizes: "512x512", type: "image/png" },
            { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,png,webp,woff2}"],
          // The ONNX Runtime binary is cached on first use instead (below),
          // and the launch screens are only read by iOS, never by the app.
          globIgnores: ["**/*.wasm", "splash/**"],
          maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
          navigateFallback: "index.html",
          navigateFallbackDenylist: [/^\/api\//],
          // A cold launch of the installed app on a poor connection would
          // otherwise wait for the network with no time limit, which on iOS
          // shows a white screen for up to a minute. Past three seconds the
          // cached shell is served and the network response only refreshes
          // the cache.
          runtimeCaching: [
            {
              // Notion, always live. First, so no later rule can answer for
              // it: an API call served the app shell instead comes back as a
              // 200 that is not JSON, which the screens then read as a reply
              // with every field missing.
              urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
              handler: "NetworkOnly",
            },
            {
              urlPattern: ({ request }) => request.mode === "navigate",
              handler: "NetworkFirst",
              options: {
                cacheName: "documents",
                networkTimeoutSeconds: 3,
                expiration: { maxEntries: 8 },
              },
            },
            {
              // ONNX Runtime binary (about 27 MB), kept out of the precache and
              // cached on first use. The model weights are cached by
              // Transformers.js in its own Cache Storage bucket.
              urlPattern: ({ url }) => url.pathname.endsWith(".wasm"),
              handler: "CacheFirst",
              options: { cacheName: "onnxruntime", expiration: { maxEntries: 4 } },
            },
          ],
        },
      }),
    ],
  };
});
