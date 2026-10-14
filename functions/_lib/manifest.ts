// The web app manifest of the dictation, in one place: vite-plugin-pwa writes
// it as /manifest.webmanifest at build time (vite.config.ts), and
// /api/auth/manifest serves it again with a start address of its own.
//
// Icon paths are absolute: the second copy is served from /api/auth/, where a
// relative path would resolve to /api/auth/icon-192.png.

export const MANIFEST = {
  name: "Mosaic",
  short_name: "Mosaic",
  description: "Dictée, réunions et contacts vers Notion.",
  lang: "fr",
  // Fixed, so a start address that varies (the sign-in handed over from a
  // computer, api/auth manifest) is still the same app.
  id: "/",
  start_url: "/",
  scope: "/",
  display: "standalone",
  orientation: "portrait",
  background_color: "#ffffff",
  theme_color: "#ffffff",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
  // The richer install dialog of Chrome on Android: phone screenshots
  // ("narrow"), all of one size. Captured from the app's own screens with
  // made-up data: `npm run screenshots` (scripts/store-screenshots.mjs).
  screenshots: [
    {
      src: "/screenshots/dictee.png",
      sizes: "1170x2532",
      type: "image/png",
      form_factor: "narrow",
      label: "Une dictée en cours : le texte s'écrit pendant que vous parlez",
    },
  ],
} as const;
