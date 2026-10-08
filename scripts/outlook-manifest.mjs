// Writes a sideloadable Outlook manifest for a given host.
//
// scripts/outlook-manifest.template.xml is the template and holds {{HOST}}
// as a placeholder, because a manifest has to carry absolute https URLs: Outlook
// fetches the taskpane itself and has no notion of a relative path. It lives
// outside public/ on purpose — served as-is it would hand an administrator a
// manifest pointing at https://{{HOST}}/.
//
// A dev manifest also gets its own Id and name. Outlook keys an installed
// add-in on its Id, so sharing one with production would mean the dev build
// replaces the real add-in in the ribbon — and whichever was sideloaded last
// wins, silently.
//
//   node scripts/outlook-manifest.mjs localhost:5173            -> .outlook/manifest.dev.xml
//   node scripts/outlook-manifest.mjs                           -> .outlook/manifest.xml (production)
//   node scripts/outlook-manifest.mjs --out dist/outlook/manifest.xml
//
// The last form is what the build runs, so the production manifest is served
// at https://<host>/outlook/manifest.xml and an administrator can install the
// add-in by URL.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const PROD_HOST = "mosaic.gouman.fr";
const DEV_ID = "9f2e4c71-5a63-4d8e-b0c4-7e1a9d3f6b28";
const DEV_NAME = "Save to Notion (dev)";

const argv = process.argv.slice(2);
const outAt = argv.indexOf("--out");
const out = outAt === -1 ? null : argv[outAt + 1];
const rest = outAt === -1 ? argv : [...argv.slice(0, outAt), ...argv.slice(outAt + 2)];
const [host = PROD_HOST, flavour = host === PROD_HOST ? "prod" : "dev"] = rest;

if (host.startsWith("http")) {
  console.error("Donnez l'hôte seul, sans schéma : localhost:5173");
  process.exit(1);
}

const root = resolve(import.meta.dirname, "..");
const templatePath = resolve(root, "scripts/outlook-manifest.template.xml");
const lockPath = resolve(root, "scripts/outlook-manifest.lock.json");
const template = await readFile(templatePath, "utf8");

// ---- The version rule ------------------------------------------------------
// Outlook redistributes an already installed add-in only when the manifest
// version is higher than the one it holds. A change that keeps the number
// therefore reaches nobody — the ribbon keeps the old label, the old icons and
// the old taskpane URL, and nothing anywhere says why.
//
// So the rule is mechanical rather than remembered: the lock file holds the
// version and a hash of everything else in the template. Change the template
// without raising the version and this refuses to write a manifest, which
// means `npm run build` fails, locally and on Vercel alike.

const version = template.match(/<Version>([^<]+)<\/Version>/)?.[1];
if (!version) {
  console.error("Le gabarit n'a pas de <Version>.");
  process.exit(1);
}

// Everything but the version line and the comments: that is what "changed"
// means here. Comments do ship inside the manifest, but Outlook does nothing
// with them, and demanding a version bump for a reworded sentence is how a
// rule stops being read.
const substance = template
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/<Version>[^<]+<\/Version>/, "<Version/>");
// The production host is part of it: the template only says {{HOST}}, yet
// moving the add-in to another domain changes every URL Outlook holds.
const fingerprint = createHash("sha256").update(`${PROD_HOST}\n${substance}`).digest("hex");

const lock = await readFile(lockPath, "utf8")
  .then(JSON.parse)
  .catch(() => null);

if (lock && lock.fingerprint !== fingerprint && lock.version === version) {
  console.error(
    [
      `Le manifeste a changé mais sa Version n'a pas bougé (${version}).`,
      "",
      "Outlook ne redistribue un complément déjà installé que sur une Version",
      "supérieure : en l'état, personne ne verrait le changement.",
      "",
      `→ Monte <Version> dans scripts/outlook-manifest.template.xml, puis relance.`,
    ].join("\n"),
  );
  process.exit(1);
}

// ---- Substitution ----------------------------------------------------------

let manifest = template.replaceAll("{{HOST}}", host);
if (flavour === "dev") {
  manifest = manifest
    .replace(/<Id>[^<]+<\/Id>/, `<Id>${DEV_ID}</Id>`)
    .replace(/<DisplayName DefaultValue="[^"]*"/, `<DisplayName DefaultValue="${DEV_NAME}"`)
    // The ribbon label too: it is what tells the two apart at a glance, which
    // matters the day both are installed side by side.
    .replace(/<bt:String id="buttonLabel" DefaultValue="[^"]*"/, `<bt:String id="buttonLabel" DefaultValue="${DEV_NAME}"`);
}

if (manifest.includes("{{HOST}}")) {
  console.error("Le gabarit contient encore {{HOST}} après substitution.");
  process.exit(1);
}

const target = resolve(root, out ?? (flavour === "dev" ? ".outlook/manifest.dev.xml" : ".outlook/manifest.xml"));
await mkdir(dirname(target), { recursive: true });
await writeFile(target, manifest);

// Only once a manifest has actually been written: a run that failed above must
// not quietly bless the change it refused.
if (!lock || lock.fingerprint !== fingerprint || lock.version !== version) {
  await writeFile(lockPath, `${JSON.stringify({ version, fingerprint }, null, 2)}\n`);
}

console.log(`manifeste ${flavour} ${version} écrit : ${target.replace(`${root}/`, "")}`);
console.log(`  taskpane : https://${host}/outlook.html`);
if (flavour === "dev") console.log(`  Id de développement : ${DEV_ID}`);
