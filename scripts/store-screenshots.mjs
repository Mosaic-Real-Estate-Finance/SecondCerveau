// Captures the screenshots of the install dialog (manifest `screenshots`) from
// the app's own screens, with made-up data: store-screens.html, served with
// vite.store-screens.config.ts. Writes public/screenshots/*.png.
//
//   npm run screenshots
//
// Needs a Chromium: PLAYWRIGHT_CHROMIUM (an executable path), or the browser
// Playwright installs (`npx playwright install chromium`).

import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const root = resolve(import.meta.dirname, "..");
const server = await createServer({ root, configFile: resolve(root, "vite.store-screens.config.ts"), server: { port: 5181 } });
await server.listen();
const base = `http://localhost:${server.config.server.port}`;

// The phone the shots are taken on: 390×844 at 3×, i.e. 1170×2532 — within
// Chrome's limits (320 to 3840 px, ratio at most 2.3).
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  colorScheme: "light",
});
const page = await context.newPage();

try {
  // A dictation under way: the live text mid sentence, the glow under it.
  await page.goto(`${base}/store-screens.html?words=24`);
  await page.getByRole("button", { name: "Dicter une note" }).click();
  await page.waitForTimeout(10_000);
  await page.screenshot({ path: resolve(root, "public/screenshots/dictee.png") });
  console.log("public/screenshots/dictee.png");
} finally {
  await browser.close();
  await server.close();
}
