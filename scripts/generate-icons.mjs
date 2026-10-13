// Renders the PWA icons from the monochrome symbol. The blue comes from the
// app's single text token; change BRAND once the client settles the logo blue.
//
// The icons are a white symbol on a blue plate. iOS reads one home screen
// icon and offers a web app no dark variant: in dark mode it swaps a light
// background for its own dark grey and keeps the symbol, so a blue symbol on
// white came out blue on near-black. White stays legible on either plate.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const BRAND = "#020342";
const source = await readFile(new URL("../src/assets/mosaic-symbole.svg", import.meta.url), "utf8");
const svg = source.replace(/currentColor/g, BRAND);
const glyphSvg = source.replace(/currentColor/g, "#ffffff");
const out = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));

// The symbol is taller than wide (102 x 117), so it is fitted on its height.
async function icon(name, size, ratio) {
  const height = Math.round(size * ratio);
  const glyph = await sharp(Buffer.from(glyphSvg), { density: 1200 }).resize({ height }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: BRAND } })
    .composite([{ input: glyph, gravity: "center" }])
    .png()
    .toFile(out(name));
}

await icon("icon-192.png", 192, 0.62);
await icon("icon-512.png", 512, 0.62);
// Maskable icons are cropped to a circle of 80 % of the canvas.
await icon("icon-maskable-512.png", 512, 0.46);
await icon("apple-touch-icon.png", 180, 0.6);
await writeFile(out("favicon.svg"), svg.replace(/<title>.*<\/title>\n/, ""));
// The notification badge: Android draws it in the status bar from its alpha
// channel alone, so it is the white symbol on nothing — an opaque icon there
// comes out as a plain white square. 96 px, the size Android asks for at its
// densest, with the margin of its small icons.
const badgeGlyph = await sharp(Buffer.from(glyphSvg), { density: 1200 }).resize({ height: 76 }).png().toBuffer();
await sharp({ create: { width: 96, height: 96, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: badgeGlyph, gravity: "center" }])
  .png()
  .toFile(out("badge-96.png"));
console.log("icons written");
