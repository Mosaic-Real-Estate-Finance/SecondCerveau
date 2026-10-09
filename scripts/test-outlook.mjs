// Tests of the attachment import (feature 003), the rules whose mistakes
// would be silent: an inline logo imported, a file attached twice on an
// enrichment, a 45 MB file cut wrong into parts, someone else's mailbox read,
// the files already on a note wiped by the new ones.
//
// Microsoft and Notion are simulated by replacing `fetch`: the routes under
// test are the real handlers, transpiled the way Vercel runs them (same
// sequence as check-api.mjs), and every request they make is answered here and
// recorded. The Microsoft identity token is a real RS256 JWT, signed with a key
// whose JWKS the fake login endpoint serves, so guard() runs unmodified.
//
//   npm run test:outlook

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { exportJWK, generateKeyPair, SignJWT, UnsecuredJWT } from "jose";

const root = resolve(import.meta.dirname, "..");
const out = mkdtempSync(join(tmpdir(), "mosaic-outlook-"));
after(() => rmSync(out, { recursive: true, force: true }));

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
    include: [join(root, "functions"), join(root, "src/outlook/attachments.ts")],
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
const load = (path) => import(pathToFileURL(join(dist, path)).href);

const rules = await load("functions/_lib/attachments.js");
const upload = await load("functions/_lib/upload.js");
const panel = await load("src/outlook/attachments.js");
const attachments = await load("functions/api/outlook/attachments.js");
const notes = await load("functions/api/outlook/notes.js");

// ---- Identity --------------------------------------------------------------

const TENANT = "11111111-2222-3333-4444-555555555555";
const CLIENT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const OID = "99999999-8888-7777-6666-555555555555";
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };

const apiToken = await new SignJWT({ tid: TENANT, oid: OID, preferred_username: "theo@gouman.fr" })
  .setProtectedHeader({ alg: "RS256", kid: "k1" })
  .setIssuer(`https://login.microsoftonline.com/${TENANT}/v2.0`)
  .setAudience(CLIENT)
  .setIssuedAt()
  .setExpirationTime("1h")
  .sign(privateKey);

// Graph tokens are Graph's to verify; the route only reads who they name.
const graphToken = (oid = OID) => new UnsecuredJWT({ tid: TENANT, oid, upn: "theo@gouman.fr" }).encode();

const env = {
  NOTION_TOKEN: "secret_test",
  NOTION_CONTACTS_DB: "contacts-db",
  NOTION_NOTES_DB: "notes-db",
  ENTRA_API_CLIENT_ID: CLIENT,
  ENTRA_TENANT_IDS: TENANT,
  NOTES_PROP_CONTACT: "Interlocuteur",
  NOTES_PROP_CLIENT_ID: "ID client",
};

// ---- Fake Microsoft and Notion ---------------------------------------------

const MB = 1024 * 1024;
const MAX = 5 * 1024 * MB; // a paid workspace

/** Graph attachments, by id. `bytes` is what $value returns. */
const mailbox = new Map();
const addAttachment = (id, meta, bytes) => mailbox.set(id, { meta, bytes });

let log = [];
let uploads = new Map();
let page = null;
let refuseHeldFiles = false;
let workspaceMax = MAX;

const reply = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const method = (init.method ?? "GET").toUpperCase();
  const path = decodeURIComponent(url.pathname);
  log.push({ method, host: url.host, path, auth: init.headers?.Authorization ?? init.headers?.authorization });

  if (url.host === "login.microsoftonline.com") return reply({ keys: [jwk] });

  if (url.host === "graph.microsoft.com") {
    const match = path.match(/attachments\/([^/]+)(\/\$value)?$/);
    const held = match && mailbox.get(match[1]);
    if (!held) return reply({ error: { code: "ErrorItemNotFound" } }, 404);
    if (match[2]) {
      return new Response(held.bytes, { headers: { "content-length": String(held.bytes.byteLength) } });
    }
    return reply(held.meta);
  }

  if (url.host === "api.notion.com") {
    const body = init.body;
    if (path === "/v1/users/me") return reply({ bot: { workspace_limits: { max_file_upload_size_in_bytes: workspaceMax } } });
    if (path === "/v1/file_uploads" && method === "POST") {
      const created = JSON.parse(body);
      const id = `upload-${uploads.size + 1}`;
      uploads.set(id, { ...created, parts: [] });
      return reply({ id, status: "pending" });
    }
    const send = path.match(/^\/v1\/file_uploads\/([^/]+)\/send$/);
    if (send) {
      const held = uploads.get(send[1]);
      const file = body.get("file");
      held.parts.push({ number: Number(body.get("part_number") ?? 1), size: file.size, name: file.name });
      return reply({ id: send[1], status: held.mode === "single_part" ? "uploaded" : "pending" });
    }
    const complete = path.match(/^\/v1\/file_uploads\/([^/]+)\/complete$/);
    if (complete) return reply({ id: complete[1], status: "uploaded" });

    // The notes base, just enough of it for the PATCH route.
    if (path === "/v1/databases/notes-db") return reply({ data_sources: [{ id: "notes-src" }] });
    if (path === "/v1/data_sources/notes-src") {
      return reply({
        properties: {
          Date: { id: "d", name: "Date", type: "date" },
          Auteur: { id: "a", name: "Auteur", type: "people" },
          Interlocuteur: { id: "i", name: "Interlocuteur", type: "relation" },
          "ID client": { id: "c", name: "ID client", type: "rich_text" },
          "Dernier message": { id: "m", name: "Dernier message", type: "rich_text" },
          Fichiers: { id: "f", name: "Fichiers", type: "files" },
        },
      });
    }
    if (path === `/v1/pages/${page?.id}` && method === "GET") return reply(page);
    if (path.startsWith(`/v1/pages/${page?.id}/properties/`)) return reply({ results: [], has_more: false });
    if (path === `/v1/blocks/${page?.id}/children` && method === "PATCH") return reply({ results: [] });
    if (path === `/v1/pages/${page?.id}` && method === "PATCH") {
      const { properties } = JSON.parse(body);
      const files = properties.Fichiers?.files;
      if (files && refuseHeldFiles && files.some((file) => file.type === "file")) {
        return reply({ object: "error", status: 400, message: "Invalid files" }, 400);
      }
      page.patches.push(properties);
      return reply({ id: page.id });
    }
  }
  throw new Error(`Requête inattendue : ${method} ${url}`);
};

const reset = () => {
  log = [];
  uploads = new Map();
};

const importRequest = (attachmentId, { token = graphToken(), bearer = apiToken } = {}) =>
  new Request("https://test/api/outlook/attachments", {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "x-graph-token": token, "content-type": "application/json" },
    body: JSON.stringify({ messageId: "msg-1", attachmentId }),
  });

const bytes = (size) => new Uint8Array(size).fill(7);

addAttachment("pdf", { "@odata.type": "#microsoft.graph.fileAttachment", name: "Offre.pdf", size: 6 * MB + 120, contentType: "application/pdf", isInline: false }, bytes(6 * MB));
addAttachment("big", { "@odata.type": "#microsoft.graph.fileAttachment", name: "Plans.zip", size: 45 * MB + 300, contentType: "application/zip", isInline: false }, bytes(45 * MB));
addAttachment("logo", { "@odata.type": "#microsoft.graph.fileAttachment", name: "image001.png", size: 9000, contentType: "image/png", isInline: true }, bytes(9000));
addAttachment("mail", { "@odata.type": "#microsoft.graph.itemAttachment", name: "Re: mandat", size: 40000, contentType: null, isInline: false }, bytes(38000));
addAttachment("cloud", { "@odata.type": "#microsoft.graph.referenceAttachment", name: "Data room", size: 0, contentType: null, isInline: false }, bytes(0));

// ---- Pure rules -------------------------------------------------------------

test("règles : images intégrées, winmail.dat et invitations sont techniques", () => {
  assert.equal(rules.technical({ name: "image001.png", isInline: true }), true);
  assert.equal(rules.technical({ name: "WINMAIL.DAT" }), true);
  assert.equal(rules.technical({ name: "x.bin", contentType: "application/ms-tnef" }), true);
  assert.equal(rules.technical({ name: "invite.ics" }), true);
  assert.equal(rules.technical({ name: "rdv", contentType: "text/calendar; method=REQUEST" }), true);
  assert.equal(rules.technical({ name: "Offre.pdf", contentType: "application/pdf", isInline: false }), false);
});

test("règles : un mail joint devient un .eml", () => {
  assert.equal(rules.fileNameOf({ "@odata.type": "#microsoft.graph.itemAttachment", name: "Re: mandat" }), "Re: mandat.eml");
  assert.equal(rules.contentTypeOf({ "@odata.type": "#microsoft.graph.itemAttachment" }), "message/rfc822");
});

test("découpe : une partie jusqu'à 20 Mo, des parties de 10 Mo au-delà", () => {
  assert.equal(upload.partsFor(20 * MB), 1);
  assert.equal(upload.partsFor(20 * MB + 1), 3);
  assert.equal(upload.partsFor(45 * MB), 5);
});

// ---- Panel candidates ------------------------------------------------------

const ref = (messageId, id, name, size, extra = {}) => ({
  messageId,
  id,
  name,
  size,
  kind: "file",
  contentType: "application/pdf",
  inline: false,
  ...extra,
});
const message = (id, attachments) => ({ id, attachments, attachmentNames: attachments.map((a) => a.name) });

test("panneau : exclusions silencieuses, lien cloud et trop lourd affichés non cochables", () => {
  const files = panel.candidates(
    [
      message("m1", [
        ref("m1", "a", "Offre.pdf", 6 * MB),
        ref("m1", "b", "image001.png", 9000, { inline: true, contentType: "image/png" }),
        ref("m1", "c", "winmail.dat", 3000),
        ref("m1", "d", "Invitation.ics", 2000, { contentType: "text/calendar" }),
        ref("m1", "e", "Data room", 0, { kind: "reference" }),
        ref("m1", "f", "Vidéo.mp4", 6 * MB, { contentType: "video/mp4" }),
      ]),
    ],
    [],
    5 * MB,
  );
  assert.deepEqual(
    files.map((file) => [file.label, file.state, file.selected]),
    [
      ["Offre.pdf", "too-big", false],
      ["Data room", "unavailable", false],
      ["Vidéo.mp4", "too-big", false],
    ],
  );
  assert.match(files[0].reason, /6 Mo, maximum 5 Mo/);
});

test("panneau : nombre et taille totale suivent les cases", () => {
  const files = panel.candidates([message("m1", [ref("m1", "a", "A.pdf", 2 * MB), ref("m1", "b", "B.pdf", 3 * MB)])], [], MAX);
  assert.deepEqual(panel.chosen(files).bytes, 5 * MB);
  files[1].selected = false;
  assert.equal(panel.chosen(files).picked.length, 1);
  assert.equal(panel.sizeLabel(5 * MB + 200 * 1024), "5,2 Mo");
});

test("panneau : un fichier déjà joint plus haut dans le fil n'est pas reproposé", () => {
  const earlier = [message("m1", [ref("m1", "a", "Offre.pdf", 1000)])];
  const written = [
    message("m2", [ref("m2", "b", "Offre.pdf", 1000), ref("m2", "c", "Mandat.pdf", 2000)]),
    message("m3", [ref("m3", "d", "Mandat.pdf", 2000)]),
  ];
  const files = panel.candidates(written, earlier, MAX);
  assert.deepEqual(files.map((file) => `${file.messageId}/${file.id}`), ["m2/c"]);
});

// ---- Import route ----------------------------------------------------------

test("import : 6 Mo en une partie, déposé chez Notion, jeton Graph envoyé à Graph seulement", async () => {
  reset();
  const response = await attachments.onRequestPost({ request: importRequest("pdf"), env });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.name, "Offre.pdf");
  assert.equal(body.size, 6 * MB);
  const created = uploads.get(body.id);
  assert.equal(created.mode, "single_part");
  assert.deepEqual(created.parts.map((part) => part.size), [6 * MB]);
  for (const call of log.filter((one) => one.host === "graph.microsoft.com")) {
    assert.match(call.auth, /^Bearer ey/);
  }
  for (const call of log.filter((one) => one.host !== "graph.microsoft.com")) {
    assert.ok(!String(call.auth ?? "").includes(graphToken()), "le jeton Graph ne sort pas vers un autre hôte");
  }
  // Metadata asked with $select: never the base64 body of the file.
  assert.ok(log.some((call) => call.host === "graph.microsoft.com" && !call.path.endsWith("$value")));
});

test("import : 45 Mo en cinq parties de 10 Mo au plus, puis complete", async () => {
  reset();
  const response = await attachments.onRequestPost({ request: importRequest("big"), env });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  const created = uploads.get(body.id);
  assert.equal(created.mode, "multi_part");
  assert.equal(created.number_of_parts, 5);
  assert.deepEqual(created.parts.map((part) => part.number), [1, 2, 3, 4, 5]);
  assert.deepEqual(created.parts.map((part) => part.size), [10, 10, 10, 10, 5].map((n) => n * MB));
  assert.ok(log.some((call) => call.path === `/v1/file_uploads/${body.id}/complete`));
});

test("import : une image intégrée est refusée par le serveur aussi", async () => {
  reset();
  const body = await (await attachments.onRequestPost({ request: importRequest("logo"), env })).json();
  assert.equal(body.skipped, true);
  assert.equal(uploads.size, 0);
});

test("import : un mail joint part en .eml, un lien cloud est non importable", async () => {
  reset();
  const eml = await (await attachments.onRequestPost({ request: importRequest("mail"), env })).json();
  assert.equal(eml.name, "Re: mandat.eml");
  assert.equal(uploads.get(eml.id).content_type, "message/rfc822");
  const cloud = await (await attachments.onRequestPost({ request: importRequest("cloud"), env })).json();
  assert.equal(cloud.skipped, true);
  assert.match(cloud.reason, /en ligne/);
});

test("import : au-delà de la limite du workspace, non importé avec la raison, rien chez Notion", async () => {
  reset();
  // A free workspace: 5 MiB. maxUploadBytes() keeps the limit for 30 minutes,
  // so the clock is moved past that on both sides of the test.
  const now = Date.now;
  let shift = 31 * 60_000;
  Date.now = () => now() + shift;
  workspaceMax = 5 * MB;
  try {
    const body = await (await attachments.onRequestPost({ request: importRequest("pdf"), env })).json();
    assert.equal(body.skipped, true);
    assert.match(body.reason, /trop lourd : 6 Mo, maximum 5 Mo/i);
    assert.equal(uploads.size, 0);
  } finally {
    workspaceMax = MAX;
    shift = 62 * 60_000;
    await attachments.onRequestGet({
      request: new Request("https://test/", { headers: { authorization: `Bearer ${apiToken}` } }),
      env,
    });
    Date.now = now;
  }
});

test("import : un jeton Graph d'une autre personne est refusé (403), rien n'est lu", async () => {
  reset();
  const response = await attachments.onRequestPost({ request: importRequest("pdf", { token: graphToken("autre") }), env });
  assert.equal(response.status, 403);
  assert.ok(!log.some((call) => call.host === "graph.microsoft.com"));
});

test("import : sans jeton d'API valide, 401", async () => {
  reset();
  const response = await attachments.onRequestPost({ request: importRequest("pdf", { bearer: "x.y.z" }), env });
  assert.equal(response.status, 401);
});

// ---- Enrichment: the files land with the mark, and the old ones stay --------

const patchRequest = (files) =>
  new Request("https://test/api/outlook/notes", {
    method: "PATCH",
    headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      noteId: "note-1",
      conversationId: "conv",
      sinceMessageId: "m1",
      contactIds: ["contact-1"],
      messages: [
        { id: "m1", receivedAt: "2026-10-01T10:00:00Z", from: { name: "A", address: "a@x.fr" }, text: "un", attachmentNames: [] },
        { id: "m2", receivedAt: "2026-10-02T10:00:00Z", from: { name: "B", address: "b@x.fr" }, text: "deux", attachmentNames: ["Mandat.pdf"] },
      ],
      files,
    }),
  });

const notePage = () => ({
  id: "note-1",
  url: "https://notion.so/note-1",
  patches: [],
  properties: {
    "Dernier message": { rich_text: [{ plain_text: "m1" }] },
    Fichiers: {
      files: [{ name: "Offre.pdf", type: "file", file: { url: "https://s3/offre?sig", expiry_time: "2026-10-09T13:00:00Z" } }],
    },
  },
});

test("enrichissement : nouveaux fichiers dans le même PATCH que la marque, existants conservés", async () => {
  reset();
  page = notePage();
  refuseHeldFiles = false;
  const response = await notes.onRequestPatch({ request: patchRequest([{ id: "upload-9", name: "Mandat.pdf" }]), env });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.filesAdded, 1);
  assert.equal(page.patches.length, 1);
  const written = page.patches[0];
  assert.equal(written["Dernier message"].rich_text[0].text.content, "m2");
  assert.deepEqual(written.Fichiers.files, [
    { name: "Offre.pdf", type: "file", file: { url: "https://s3/offre?sig" } },
    { type: "file_upload", name: "Mandat.pdf", file_upload: { id: "upload-9" } },
  ]);
});

test("enrichissement : si Notion refuse de reprendre les existants, la marque passe sans les fichiers", async () => {
  reset();
  page = notePage();
  refuseHeldFiles = true;
  const body = await (await notes.onRequestPatch({ request: patchRequest([{ id: "upload-9", name: "Mandat.pdf" }]), env })).json();
  refuseHeldFiles = false;
  assert.equal(body.filesAdded, 0);
  assert.deepEqual(body.filesSkipped.map((file) => file.name), ["Mandat.pdf"]);
  assert.equal(page.patches.length, 1);
  assert.equal(page.patches[0].Fichiers, undefined, "les fichiers existants ne sont pas touchés");
  assert.equal(page.patches[0]["Dernier message"].rich_text[0].text.content, "m2");
});

test("enrichissement : rien de nouveau, aucun fichier attaché", async () => {
  reset();
  page = notePage();
  page.properties["Dernier message"] = { rich_text: [{ plain_text: "m2" }] };
  const request = patchRequest([{ id: "upload-9", name: "Mandat.pdf" }]);
  const sent = await request.json();
  const replay = new Request(request.url, {
    method: "PATCH",
    headers: request.headers,
    body: JSON.stringify({ ...sent, sinceMessageId: "m2" }),
  });
  const body = await (await notes.onRequestPatch({ request: replay, env })).json();
  assert.equal(body.messagesAdded, 0);
  assert.equal(page.patches.length, 0);
});
