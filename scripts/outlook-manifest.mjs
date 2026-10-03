// Writes a sideloadable Outlook manifest for a given host.
//
// public/outlook/manifest.xml is the template and holds HOST as a placeholder,
// because a manifest has to carry absolute https URLs: Outlook fetches the
// taskpane itself and has no notion of a relative path.
//
// A dev manifest also gets its own Id and name. Outlook keys an installed
// add-in on its Id, so sharing one with production would mean the dev build
// replaces the real add-in in the ribbon — and whichever was sideloaded last
// wins, silently.
//
//   node scripts/outlook-manifest.mjs localhost:5173           -> .outlook/manifest.dev.xml
//   node scripts/outlook-manifest.mjs notes.mosaicfin.com prod -> .outlook/manifest.xml

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEV_ID = "9f2e4c71-5a63-4d8e-b0c4-7e1a9d3f6b28";
const DEV_NAME = "Save to Notion (dev)";

const [host, flavour = "dev"] = process.argv.slice(2);
if (!host) {
  console.error("Usage : node scripts/outlook-manifest.mjs <hôte> [dev|prod]");
  process.exit(1);
}
if (host.startsWith("http")) {
  console.error("Donnez l'hôte seul, sans schéma : localhost:5173");
  process.exit(1);
}

const root = resolve(import.meta.dirname, "..");
const template = await readFile(resolve(root, "public/outlook/manifest.xml"), "utf8");

let manifest = template.replaceAll("HOST", host);
if (flavour === "dev") {
  manifest = manifest
    .replace(/<Id>[^<]+<\/Id>/, `<Id>${DEV_ID}</Id>`)
    .replace(/<DisplayName DefaultValue="[^"]*"/, `<DisplayName DefaultValue="${DEV_NAME}"`)
    // The ribbon label too: it is what tells the two apart at a glance, which
    // matters the day both are installed side by side.
    .replace(/<bt:String id="buttonLabel" DefaultValue="[^"]*"/, '<bt:String id="buttonLabel" DefaultValue="Save to Notion (dev)"');
}

if (manifest.includes("HOST")) {
  console.error("Le gabarit contient encore HOST après substitution.");
  process.exit(1);
}

const out = resolve(root, flavour === "dev" ? ".outlook/manifest.dev.xml" : ".outlook/manifest.xml");
await mkdir(dirname(out), { recursive: true });
await writeFile(out, manifest);

console.log(`manifeste ${flavour} écrit : ${out.replace(`${root}/`, "")}`);
console.log(`  taskpane : https://${host}/outlook.html`);
if (flavour === "dev") console.log(`  Id de développement : ${DEV_ID}`);
