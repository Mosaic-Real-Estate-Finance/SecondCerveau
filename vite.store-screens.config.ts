import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Serves store-screens.html for `npm run screenshots`: the app's screens with
// the recorder, the notes and the network check swapped for stand-ins
// (src/store-screens). The exact module names are matched before "@".
const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/lib\/use-recorder$/, replacement: src("store-screens/fake-recorder.ts") },
      { find: /^@\/lib\/notes$/, replacement: src("store-screens/fake-notes.ts") },
      { find: /^@\/lib\/connectivity$/, replacement: src("store-screens/fake-connectivity.ts") },
      { find: "@", replacement: src("") },
    ],
  },
  plugins: [react(), tailwindcss()],
});
