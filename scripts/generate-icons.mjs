// Renders the PWA icons from the monochrome symbol. The blue comes from the
// app's single text token; change BRAND once the client settles the logo blue.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const BRAND = "#020342";
const source = await readFile(new URL("../src/assets/mosaic-symbole.svg", import.meta.url), "utf8");
const svg = source.replace(/currentColor/g, BRAND);
const out = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));

// The symbol is taller than wide (102 x 117), so it is fitted on its height.
async function icon(name, size, ratio) {
  const height = Math.round(size * ratio);
  const glyph = await sharp(Buffer.from(svg), { density: 1200 }).resize({ height }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: "#ffffff" } })
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
console.log("icons written");
