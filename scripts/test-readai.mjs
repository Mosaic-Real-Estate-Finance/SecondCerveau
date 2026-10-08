// Tests of the Read AI rules whose mistakes would be silent: a signature
// accepted wrongly, a participant attached on a substring, a mail provider
// offered as a company, a transcript cut or out of order, two reports of one
// meeting kept as two.
//
// Same sequence as check-api.mjs — transpile only, then let Node resolve the
// output — so the modules under test are the ones Vercel will run.
//
//   npm run test:readai

import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { run } from "node:test";
import { spec } from "node:test/reporters";

const root = resolve(import.meta.dirname, "..");
const out = mkdtempSync(join(tmpdir(), "mosaic-readai-"));

writeFileSync(
  join(out, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      target: "ES2023",
      module: "nodenext",
      moduleResolution: "nodenext",
      skipLibCheck: true,
      outDir: join(out, "dist"),
      rootDir: root,
    },
    include: [join(root, "functions")],
  }),
);
try {
  execFileSync("npx", ["tsc", "-p", join(out, "tsconfig.json")], { cwd: root, stdio: "pipe" });
} catch {
  // Emitted anyway; type errors are typecheck's business.
}
const dist = join(out, "dist");
writeFileSync(join(dist, "package.json"), JSON.stringify({ type: "module" }));
symlinkSync(join(root, "node_modules"), join(dist, "node_modules"));

const lib = (path) => import(pathToFileURL(join(dist, "functions/_lib", path)).href);
const payload = await lib("readai/payload.js");
const participants = await lib("readai/participants.js");
const match = await lib("readai/match.js");
const key = await lib("readai/meeting-key.js");
const note = await lib("readai/note.js");
const thread = await lib("thread.js");

const testFile = join(out, "readai.test.mjs");
globalThis.__readai = { payload, participants, match, key, note, thread, createHmac };
writeFileSync(
  testFile,
  `
import { test } from "node:test";
import assert from "node:assert/strict";
const { payload, participants, match, key, note, thread, createHmac } = globalThis.__readai;

// ---- Signature (research B-1) ----------------------------------------------

const SECRET = "GHx4YT/StkcArjYPypjFG48FbZvgzBuDBOz5pCecbro=";
const sign = (body, secret = SECRET) =>
  createHmac("sha256", Buffer.from(secret, "base64")).update(body).digest("hex");

test("signature : la clé est décodée en base64, comme l'exemple officiel", () => {
  const body = '{"trigger":"meeting_end","title":"Réunion"}';
  assert.equal(payload.verifySignature(Buffer.from(body), sign(body), SECRET), true);
  assert.equal(payload.verifySignature(Buffer.from(body), sign(body).toUpperCase(), SECRET), true);
});

test("signature : clé utilisée en texte brut → refusée", () => {
  const body = "{}";
  const wrong = createHmac("sha256", SECRET).update(body).digest("hex");
  assert.equal(payload.verifySignature(Buffer.from(body), wrong, SECRET), false);
});

test("signature : absente, tronquée, corps modifié, secret absent → refusée", () => {
  const body = '{"a":1}';
  assert.equal(payload.verifySignature(Buffer.from(body), null, SECRET), false);
  assert.equal(payload.verifySignature(Buffer.from(body), sign(body).slice(0, 10), SECRET), false);
  assert.equal(payload.verifySignature(Buffer.from('{"a":2}'), sign(body), SECRET), false);
  assert.equal(payload.verifySignature(Buffer.from(body), sign(body), undefined), false);
});

// ---- Payload ----------------------------------------------------------------

const START = "2026-10-08T09:00:00Z";
const T0 = Date.parse(START);
const sample = (overrides = {}) => ({
  session_id: "S1",
  trigger: "meeting_end",
  title: "Point dossier",
  start_time: START,
  end_time: "2026-10-08T10:00:00Z",
  participants: [
    { name: "Oscar B", first_name: "Oscar", last_name: "B", email: "OB@mosaicfin.com " },
    { name: "Arsène G", first_name: "Arsène", last_name: "G", email: "arsene@gouman.fr" },
    { name: "Sans Mail", first_name: "Sans", last_name: "Mail", email: null },
  ],
  owner: { name: "Xavier N", first_name: "Xavier", last_name: "N", email: "xn@mosaicfin.com" },
  summary: "Résumé",
  transcript: {
    speaker_blocks: [
      { start_time: String(T0 + 5_000), end_time: "0", speaker: { name: "Oscar B" }, words: "Bonjour" },
      { start_time: String(T0 + 3_725_000), end_time: "0", speaker: { name: "Arsène G" }, words: "Au revoir" },
    ],
    speakers: [],
  },
  platform: "zoom",
  platform_meeting_id: "123",
  request_id: "R1",
  ...overrides,
});

test("payload : horodatage relatif au début, chaînes de millisecondes", () => {
  const meeting = payload.parseMeeting(sample());
  assert.deepEqual(meeting.blocks.map((block) => payload.clock(block.at)), ["00:05", "1:02:05"]);
});

test("payload : début postérieur au premier bloc → référence au premier bloc, jamais négatif", () => {
  const meeting = payload.parseMeeting(sample({ start_time: "2026-10-08T09:30:00Z" }));
  assert.equal(meeting.blocks[0].at, 0);
  assert.ok(meeting.blocks.every((block) => block.at >= 0));
});

test("payload : sans session_id → null", () => {
  assert.equal(payload.parseMeeting(sample({ session_id: "" })), null);
});

// ---- Participants (brief §5.1 – 5.3) ---------------------------------------

test("participants : owner ajouté, emails normalisés, trois groupes, auteurs de users.ts", () => {
  const meeting = payload.parseMeeting(sample());
  const split = participants.split(meeting, ["mosaicfin.com"], new Set());
  assert.deepEqual(split.externals.map((person) => person.email), ["arsene@gouman.fr"]);
  assert.deepEqual(split.authors.map((author) => author.email).sort(), ["ob@mosaicfin.com", "xn@mosaicfin.com"]);
  assert.deepEqual(split.counts, { noEmail: 1, internal: 2, excluded: 0 });
});

test("participants : réunion interne seulement → aucun externe", () => {
  const meeting = payload.parseMeeting(sample({ participants: [{ name: "P", email: "pb@mosaicfin.com" }] }));
  assert.equal(participants.split(meeting, ["mosaicfin.com"], new Set()).externals.length, 0);
});

test("participants : un exclu est retiré des externes", () => {
  const meeting = payload.parseMeeting(sample());
  const split = participants.split(meeting, ["mosaicfin.com"], new Set(["arsene@gouman.fr"]));
  assert.equal(split.externals.length, 0);
  assert.equal(split.counts.excluded, 1);
});

test("participants : même adresse deux fois → une seule entrée", () => {
  const meeting = payload.parseMeeting(
    sample({ participants: [{ name: "A", email: "a@x.fr" }, { name: "A bis", email: " A@X.fr" }], owner: null }),
  );
  assert.equal(participants.split(meeting, [], new Set()).externals.length, 1);
});

// ---- Rapprochement (brief §5.4) --------------------------------------------

const generic = new Set(match.GENERIC_DOMAINS);
const row = (id, emails, companies) => ({ id, name: id, emails, companies });
const GOUMAN = { id: "c-gouman", name: "Gouman" };

test("rapprochement : égalité stricte, une sous-chaîne ne reconnaît pas", () => {
  const result = match.decide(["o@m.com"], [row("theo", ["theo@m.com"], [])], generic);
  assert.equal(result["o@m.com"].status, "unknown");
});

test("rapprochement : une adresse parmi plusieurs séparées par des virgules", () => {
  const rows = [row("theo", match.addressesOf("Theo@gouman.fr , t@autre.fr"), [GOUMAN])];
  assert.equal(match.decide(["t@autre.fr"], rows, generic)["t@autre.fr"].status, "recognized");
});

test("rapprochement : arsene@gouman.fr → société de Théo suggérée, jamais reconnu", () => {
  const result = match.decide(["arsene@gouman.fr"], [row("theo", ["theo@gouman.fr"], [GOUMAN])], generic);
  assert.deepEqual(result["arsene@gouman.fr"], { status: "unknown", companies: [GOUMAN] });
});

test("rapprochement : @gmail.com inconnu → aucune suggestion", () => {
  const result = match.decide(["inconnu@gmail.com"], [row("x", ["autre@gmail.com"], [GOUMAN])], generic);
  assert.deepEqual(result["inconnu@gmail.com"], { status: "unknown", companies: [] });
});

test("rapprochement : un domaine sur deux sociétés → les deux proposées", () => {
  const rows = [
    row("a", ["a@groupe.fr"], [{ id: "h", name: "Holding" }]),
    row("b", ["b@groupe.fr"], [{ id: "f", name: "Filiale" }]),
  ];
  const result = match.decide(["c@groupe.fr"], rows, generic);
  assert.deepEqual(result["c@groupe.fr"].companies.map((company) => company.name).sort(), ["Filiale", "Holding"]);
});

test("rapprochement : domaine comparé strictement (sous-domaine différent)", () => {
  const result = match.decide(["a@groupe.fr"], [row("x", ["b@mail.groupe.fr"], [GOUMAN])], generic);
  assert.deepEqual(result["a@groupe.fr"].companies, []);
});

test("rapprochement : même adresse sur deux contacts → les deux proposés", () => {
  const rows = [row("a", ["d@x.fr"], []), row("b", ["d@x.fr"], [])];
  const result = match.decide(["d@x.fr"], rows, generic);
  assert.equal(result["d@x.fr"].status, "ambiguous");
  assert.equal(result["d@x.fr"].candidates.length, 2);
});

test("rapprochement : GENERIC_EMAIL_DOMAINS remplace la liste", () => {
  assert.deepEqual([...match.genericDomains({ GENERIC_EMAIL_DOMAINS: "Foo.fr, bar.com" })], ["foo.fr", "bar.com"]);
  assert.ok(match.genericDomains({}).has("orange.fr"));
});

// ---- Une réunion, une note (brief §6, research C-2) ------------------------

test("clé : identifiant de plateforme, sinon session", () => {
  assert.equal(key.keyOf({ platform: "zoom", platformMeetingId: "123", sessionId: "S" }), "readai:zoom:123");
  assert.equal(key.keyOf({ platform: "read", platformMeetingId: null, sessionId: "S" }), "readai:session:S");
});

test("repli : même titre, 9 min d'écart, un externe commun → même réunion", () => {
  const a = key.traceOf("Point dossier", "2026-10-08T09:00:00Z", ["a@x.fr", "b@y.fr"]);
  const b = key.traceOf(" point DOSSIER ", "2026-10-08T09:09:00Z", ["b@y.fr"]);
  assert.equal(key.sameMeeting(a, b), true);
  assert.equal(key.findSame(b, { "readai:zoom:1": a }), "readai:zoom:1");
});

test("repli : 11 min d'écart, ou aucun externe commun, ou autre titre → deux réunions", () => {
  const a = key.traceOf("Point", "2026-10-08T09:00:00Z", ["a@x.fr"]);
  assert.equal(key.sameMeeting(a, key.traceOf("Point", "2026-10-08T09:11:00Z", ["a@x.fr"])), false);
  assert.equal(key.sameMeeting(a, key.traceOf("Point", "2026-10-08T09:01:00Z", ["z@x.fr"])), false);
  assert.equal(key.sameMeeting(a, key.traceOf("Autre", "2026-10-08T09:01:00Z", ["a@x.fr"])), false);
});

test("repli : l'index ne garde ni titre ni email en clair", () => {
  const trace = key.traceOf("Point dossier", START, ["arsene@gouman.fr"]);
  const text = JSON.stringify(trace);
  assert.ok(!text.includes("Point") && !text.includes("arsene"));
});

// ---- Corps de la note (brief §7) -------------------------------------------

test("transcription : nom en gras, horodatage, texte, dans l'ordre", () => {
  const meeting = payload.parseMeeting(sample());
  const [first, second] = note.transcriptParagraphs(meeting);
  const parts = first.paragraph.rich_text;
  assert.equal(parts[0].text.content, "Oscar B ");
  assert.equal(parts[0].annotations.bold, true);
  assert.equal(parts[1].text.content, "(00:05) — Bonjour");
  assert.ok(second.paragraph.rich_text[1].text.content.startsWith("(1:02:05)"));
});

test("transcription : une heure de réunion, des lots de 100 blocs au plus, rien de perdu", () => {
  const blocks = Array.from({ length: 640 }, (_, index) => ({
    start_time: String(T0 + index * 5_600),
    speaker: { name: index % 2 ? "A" : "B" },
    words: "x".repeat(index % 7 === 0 ? 4_500 : 120),
  }));
  const meeting = payload.parseMeeting(sample({ transcript: { speaker_blocks: blocks } }));
  const paragraphs = note.transcriptParagraphs(meeting);
  assert.equal(paragraphs.length, 640);
  for (const block of paragraphs) {
    for (const part of block.paragraph.rich_text) assert.ok(part.text.content.length <= 2000);
  }
  const batches = thread.batches(paragraphs);
  assert.ok(batches.every((batch) => batch.length <= 100));
  assert.equal(batches.flat().length, 640);
});

test("résumé : un paragraphe par ligne, jamais vide", () => {
  assert.equal(note.summaryParagraphs("A\\n\\nB\\nC").length, 3);
  assert.equal(note.summaryParagraphs("").length, 1);
});
`,
);

let failed = false;
try {
  const stream = run({ files: [testFile], isolation: "none" });
  stream.on("test:fail", () => {
    failed = true;
  });
  await new Promise((done, reject) => {
    stream.compose(spec).pipe(process.stdout);
    stream.on("end", done);
    stream.on("error", reject);
  });
} finally {
  rmSync(out, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
