// The add-in's own icons, rendered from public/outlook/logo.svg.
//
// Outlook asks for five sizes on desktop and the web, and nine on mobile (25,
// 32 and 48 points, each at scales 1, 2 and 3 — feature 003). It fetches them
// itself, from the manifest; they have to be real files at real URLs. Kept transparent outside the shape: the
// ribbon is light on the web and dark in some desktop themes, and the logo
// carries its own white page behind the symbol either way.
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import sharp from "sharp";

const svg = await readFile(new URL("../public/outlook/logo.svg", import.meta.url));
const out = (name) => fileURLToPath(new URL(`../public/outlook/${name}`, import.meta.url));

// Rasterised well above the target first, then reduced: at 16 px the thin
// navy border of the page would otherwise vanish into the aliasing. 300 dpi
// on a 512 unit viewBox gives about 2100 px to downsample from.
for (const size of [16, 32, 64, 80, 128]) {
  await sharp(svg, { density: 300 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(out(`icon-${size}.png`));
}
// Mobile: one file per scale, so a 3x screen gets 144 real pixels rather than
// 48 stretched. Named after the point size, the scale as a suffix.
for (const points of [25, 32, 48]) {
  for (const scale of [1, 2, 3]) {
    await sharp(svg, { density: 300 })
      .resize(points * scale, points * scale, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(out(`icon-${points}${scale === 1 ? "" : `@${scale}x`}.png`));
  }
}
console.log("outlook icons written from logo.svg");
