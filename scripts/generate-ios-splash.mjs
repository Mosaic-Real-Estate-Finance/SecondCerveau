// iOS launch screens. Safari only shows one when an apple-touch-startup-image
// matches the device's physical resolution exactly; otherwise the app opens on
// a white flash. It also ignores prefers-color-scheme on these images, so a
// single image per device is generated, in the app's own background colour.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const BACKGROUND = "#ffffff";
const BRAND = "#020342";

// [logical width, logical height, device pixel ratio], portrait.
export const DEVICES = [
  [320, 568, 2], // SE 1
  [375, 667, 2], // SE 2 / 3, 8
  [414, 736, 3], // 8 Plus
  [375, 812, 3], // X, XS, 11 Pro, 12 mini, 13 mini
  [414, 896, 2], // XR, 11
  [414, 896, 3], // XS Max, 11 Pro Max
  [390, 844, 3], // 12, 13, 14
  [393, 852, 3], // 14 Pro, 15, 16
  [402, 874, 3], // 16 Pro
  [428, 926, 3], // 12/13 Pro Max, 14 Plus
  [430, 932, 3], // 14/15 Pro Max, 16 Plus
  [440, 956, 3], // 16 Pro Max
];

export const splashPath = ([lw, lh, dpr]) => `splash/apple-splash-${lw * dpr}-${lh * dpr}.png`;

const out = (file) => fileURLToPath(new URL(`../public/${file}`, import.meta.url));

// Comparing paths, not URLs: an accent in the directory name is
// percent-encoded in import.meta.url but not in argv.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const source = await readFile(fileURLToPath(new URL("../src/assets/mosaic-symbole.svg", import.meta.url)), "utf8");
  const svg = source.replace(/currentColor/g, BRAND);
  await mkdir(out("splash"), { recursive: true });

  for (const device of DEVICES) {
    const [lw, lh, dpr] = device;
    const width = lw * dpr;
    const height = lh * dpr;
    // The symbol keeps the same optical size as on the home screen icon.
    const glyph = await sharp(Buffer.from(svg), { density: 1200 })
      .resize({ height: Math.round(height * 0.12) })
      .png()
      .toBuffer();
    await sharp({ create: { width, height, channels: 4, background: BACKGROUND } })
      .composite([{ input: glyph, gravity: "center" }])
      .png({ compressionLevel: 9 })
      .toFile(out(splashPath(device)));
  }

  // The <link> tags for index.html, so the list cannot drift from the images.
  const links = DEVICES.map(
    (device) =>
      `    <link rel="apple-touch-startup-image" media="(device-width: ${device[0]}px) and (device-height: ${device[1]}px) and (-webkit-device-pixel-ratio: ${device[2]}) and (orientation: portrait)" href="/${splashPath(device)}" />`,
  ).join("\n");
  await writeFile(out("splash/links.html"), `${links}\n`);
  console.log(`splash: ${DEVICES.length} images générées`);
}
