import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { getHttpsServerOptions } from "office-addin-dev-certs";
import { MANIFEST } from "./functions/_lib/manifest.js";

// Private Network Access, for `npm run dev:outlook`: Outlook on the web is a
// public origin asking a loopback one for the taskpane, and Chromium guards
// that.
//
// Under the old PNA model the browser sends a preflight carrying
// `Access-Control-Request-Private-Network` and expects this answer, so the
// answer is given. Under Local Network Access, which replaced PNA in Chrome
// 141, no header helps at all: the gate is a user permission that the
// *embedding* site has to hold, and that is Microsoft's page, not ours. This
// block therefore only covers Chromium builds still on PNA.
//
// Connect runs its layers in order, and Vite installs its own CORS middleware
// before any plugin's; it answers an OPTIONS preflight and ends it, so a
// middleware added normally never sees one. This layer is moved to the front
// of the stack.
function taskpaneHeaders(): Plugin {
  const allowPrivateNetwork = (
    req: { url?: string; headers: Record<string, string | string[] | undefined> },
    res: { setHeader(name: string, value: string | string[]): unknown },
    next: () => void,
  ) => {
    if ((req.url ?? "").startsWith("/outlook") && req.headers["access-control-request-private-network"]) {
      res.setHeader("Access-Control-Allow-Private-Network", "true");
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
      res.setHeader("Access-Control-Allow-Headers", req.headers["access-control-request-headers"] ?? "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
      res.setHeader("Access-Control-Max-Age", "600");
    }
    next();
  };
  const first = (middlewares: { use(fn: unknown): unknown; stack: unknown[] }) => {
    middlewares.use(allowPrivateNetwork);
    const layer = middlewares.stack.pop();
    if (layer) middlewares.stack.unshift(layer);
  };
  return {
    name: "taskpane-headers",
    configureServer: (server) => first(server.middlewares as never),
    configurePreviewServer: (server) => first(server.middlewares as never),
  };
}

// Runs the handlers of functions/api in the Vite dev server, so the app talks
// to the exact same code locally and in production (where api/ wraps them as
// Vercel functions).
function pagesFunctions(env: Record<string, string>): Plugin {
  const routes: Record<string, { file: string; name: string }> = {
    "GET /api/contacts": { file: "/functions/api/contacts.ts", name: "onRequestGet" },
    "POST /api/contacts": { file: "/functions/api/contacts.ts", name: "onRequestPost" },
    "GET /api/companies": { file: "/functions/api/companies.ts", name: "onRequestGet" },
    "POST /api/companies": { file: "/functions/api/companies.ts", name: "onRequestPost" },
    "POST /api/session": { file: "/functions/api/session.ts", name: "onRequestPost" },
    "POST /api/notes": { file: "/functions/api/notes.ts", name: "onRequestPost" },
    "POST /api/files": { file: "/functions/api/files.ts", name: "onRequestPost" },
    "POST /api/outlook/contacts/match": {
      file: "/functions/api/outlook/contacts/match.ts",
      name: "onRequestPost",
    },
    "POST /api/outlook/contacts": { file: "/functions/api/outlook/contacts/index.ts", name: "onRequestPost" },
    "GET /api/outlook/attachments": { file: "/functions/api/outlook/attachments.ts", name: "onRequestGet" },
    "POST /api/outlook/attachments": { file: "/functions/api/outlook/attachments.ts", name: "onRequestPost" },
    "GET /api/outlook/notes": { file: "/functions/api/outlook/notes.ts", name: "onRequestGet" },
    "POST /api/outlook/notes": { file: "/functions/api/outlook/notes.ts", name: "onRequestPost" },
    "PATCH /api/outlook/notes": { file: "/functions/api/outlook/notes.ts", name: "onRequestPatch" },
    "GET /api/session": { file: "/functions/api/session.ts", name: "onRequestGet" },
    "POST /api/readai/webhook": { file: "/functions/api/readai/webhook.ts", name: "onRequestPost" },
    "GET /api/readai/items": { file: "/functions/api/readai/screen.ts", name: "onRequestGet" },
    "POST /api/readai/decide": { file: "/functions/api/readai/screen.ts", name: "onRequestPost" },
    "POST /api/readai/settle": { file: "/functions/api/readai/screen.ts", name: "onRequestPost" },
    "POST /api/readai/ignore": { file: "/functions/api/readai/screen.ts", name: "onRequestPost" },
    "POST /api/readai/retry": { file: "/functions/api/readai/screen.ts", name: "onRequestPost" },
    "POST /api/readai/excluded": { file: "/functions/api/readai/screen.ts", name: "onRequestPost" },
    "POST /api/readai/push": { file: "/functions/api/readai/screen.ts", name: "onRequestPost" },
    "DELETE /api/readai/push": { file: "/functions/api/readai/screen.ts", name: "onRequestDelete" },
    "POST /api/auth/code": { file: "/functions/api/auth.ts", name: "onRequestPost" },
    "POST /api/auth/verify": { file: "/functions/api/auth.ts", name: "onRequestPost" },
    "POST /api/auth/logout": { file: "/functions/api/auth.ts", name: "onRequestPost" },
    "POST /api/auth/stt-token": { file: "/functions/api/auth.ts", name: "onRequestPost" },
    "POST /api/auth/handoff": { file: "/functions/api/auth.ts", name: "onRequestPost" },
    "POST /api/auth/redeem": { file: "/functions/api/auth.ts", name: "onRequestPost" },
    "GET /api/auth/manifest": { file: "/functions/api/auth.ts", name: "onRequestGet" },
    "POST /api/auth/stt-alert": { file: "/functions/api/auth.ts", name: "onRequestPost" },
    "GET /api/auth/stt-resolved": { file: "/functions/api/auth.ts", name: "onRequestGet" },
    "POST /api/auth/stt-resolved": { file: "/functions/api/auth.ts", name: "onRequestPost" },
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
          // The real host, so that a link the server builds (the QR code's)
          // points at this server, phone included in `dev:mobile`.
          const scheme = (server.config.server.https ? "https" : "http");
          const request = new Request(`${scheme}://${req.headers.host ?? "localhost"}${req.url}`, {
            method: req.method,
            headers,
            body: chunks.length ? Buffer.concat(chunks) : undefined,
          });
          const module = await server.ssrLoadModule(route.file);
          const response: Response = await module[route.name]({ request, env });
          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            if (key !== "set-cookie") res.setHeader(key, value);
          });
          const cookies = response.headers.getSetCookie();
          if (cookies.length) res.setHeader("Set-Cookie", cookies);
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

// Outlook on the web loads the taskpane in an iframe and refuses a certificate
// its browser does not trust — there is no warning to click through inside an
// iframe. `npm run dev:outlook` therefore serves the same app behind the
// certificate issued by office-addin-dev-certs, whose CA is installed in the
// system trust store.
//
// It is a separate mode on purpose. `dev:mobile` keeps its self-signed
// certificate, because that is the one the phone has already accepted and the
// installed PWA is in use: a new certificate there means a new warning, and an
// untrusted certificate in a standalone PWA fails as a blank screen rather
// than as a question.
async function trustedHttps(mode: string) {
  if (mode !== "outlook") return undefined;
  try {
    return await getHttpsServerOptions();
  } catch {
    throw new Error(
      "Certificat de développement absent. Lancez une fois :\n" +
        "  npx office-addin-dev-certs install --days 365 --domains 127.0.0.1,localhost,192.168.1.86",
    );
  }
}

/**
 * Keeps the dictation's web app manifest off the taskpane page.
 *
 * vite-plugin-pwa injects `<link rel="manifest">` into every HTML entry, and
 * outlook.html is one. The taskpane would then declare the dictation's name
 * and the dictation's icons as its own identity — in a page whose whole point
 * is to be the add-in, and which is not installable in the first place.
 *
 * `enforce: "post"` so this runs after the injection it undoes.
 */
function taskpaneIsNotTheApp(): Plugin {
  return {
    name: "mosaic-taskpane-identity",
    enforce: "post",
    transformIndexHtml: {
      order: "post",
      handler(html, context) {
        if (!["outlook", "maquette", "welcome"].some((page) => context.path.includes(page))) return html;
        return html.replace(/\s*<link rel="manifest"[^>]*>/g, "");
      },
    },
  };
}

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const https = await trustedHttps(mode);
  return {
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    server: https ? { https } : {},
    preview: https ? { https } : {},
    // Two entries: the dictation PWA, and the Outlook taskpane. They share the
    // components and the brand, nothing else.
    build: {
      rollupOptions: {
        input: {
          main: fileURLToPath(new URL("./index.html", import.meta.url)),
          outlook: fileURLToPath(new URL("./outlook.html", import.meta.url)),
          // A mockup of the Notifications screen, without sign-in (src/maquette).
          maquette: fileURLToPath(new URL("./maquette.html", import.meta.url)),
          // The clients' onboarding, public, without sign-in (src/welcome).
          welcome: fileURLToPath(new URL("./welcome.html", import.meta.url)),
        },
      },
    },
    plugins: [
      // `npm run dev:mobile`: HTTPS on the local network with a self-signed
      // certificate, because iOS only opens the microphone on a secure origin.
      // Only for the phone. In `outlook` mode the trusted certificate above
      // takes over, and two plugins fighting over `server.https` would leave
      // whichever ran last.
      mode === "mobile" && basicSsl({ name: "mosaic-dictee" }),
      react(),
      tailwindcss(),
      taskpaneHeaders(),
      pagesFunctions(env),
      VitePWA({
        registerType: "autoUpdate",
        // Shared with /api/auth/manifest, which serves it with another start address.
        manifest: { ...MANIFEST, icons: [...MANIFEST.icons] },
        workbox: {
          // The push and notification click listeners (feature 002). Added
          // to the generated worker rather than switching to injectManifest,
          // so every caching rule below stays exactly as it was.
          importScripts: ["push-sw.js"],
          globPatterns: ["**/*.{js,css,html,svg,png,webp,woff2}"],
          // The launch screens are only read by iOS, never by the app; the
          // install animation only plays in the install guide, in the
          // browser, online — not worth a place in every install's cache.
          //
          // The Outlook taskpane is excluded too, and that one matters: this
          // service worker has scope "/", so it controls /outlook whether the
          // taskpane asks for it or not. Precached, outlook.html would be
          // served from the dictation's cache — the denylist below only governs
          // the navigation fallback, never an exact precache hit — and the
          // add-in would run on a stale build with no way to notice.
          globIgnores: ["splash/**", "pwa-install-animation.html", "pwa-anim/**", "outlook.html", "outlook/**", "assets/outlook-*.js", "assets/outlook-*.css", "maquette.html", "assets/maquette-*", "welcome.html", "assets/welcome-*"],
          navigateFallback: "index.html",
          // The dictation's service worker has scope "/", so without /outlook
          // on this list it answers a taskpane navigation with the dictation
          // shell — and the add-in shows the wrong application entirely.
          //
          // And never for an address that names a file. The install guide
          // shows /pwa-install-animation.html in an iframe — a navigation, to
          // this worker — and was handed the app shell instead: the app then
          // ran inside its own guide, which opened its guide, and so on, each
          // sheet stacked in the one before.
          navigateFallbackDenylist: [/^\/api\//, /^\/outlook/, /^\/maquette/, /^\/welcome/, /^\/[^?#]*\.[a-z0-9]+(?:[?#]|$)/i],
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
              // The taskpane, always live, for the same reason: this service
              // worker belongs to the dictation and must be transparent to the
              // other tool. Without this rule the navigate rule below would
              // answer /outlook.html from the dictation's document cache.
              urlPattern: ({ url }) => url.pathname.startsWith("/outlook"),
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
          ],
        },
      }),
      // After VitePWA on purpose: it undoes an injection that plugin makes,
      // and two "post" plugins run in the order of this array.
      taskpaneIsNotTheApp(),
    ],
  };
});
