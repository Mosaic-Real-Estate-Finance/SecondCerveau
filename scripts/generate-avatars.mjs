import { readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// The faces of the share sheet in the install animation. They are drawn at
// 70 px, so 140 px covers a 2x screen and stays under 3 kB each.
const SIZE = 140;

const here = dirname(fileURLToPath(import.meta.url));
const from = resolve(here, "../src/assets/photos");
const to = resolve(here, "../public/pwa-anim/avatars");

const slug = (name) =>
  basename(name, ".jpeg")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-");

const photos = (await readdir(from)).filter((name) => name.endsWith(".jpeg"));
for (const photo of photos) {
  const out = join(to, `${slug(photo)}.webp`);
  const { size } = await sharp(join(from, photo))
    .resize(SIZE, SIZE, { fit: "cover" })
    .webp({ quality: 82 })
    .toFile(out);
  console.log(`${basename(out)} ${(size / 1024).toFixed(1)} kB`);
}
