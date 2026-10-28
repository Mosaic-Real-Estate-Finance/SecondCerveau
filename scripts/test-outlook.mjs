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
    include: [
      join(root, "functions"),
      join(root, "src/outlook/attachments.ts"),
      join(root, "src/outlook/entra-config.ts"),
      join(root, "src/outlook/auth-detail.ts"),
      join(root, "src/outlook/signature.ts"),
      join(root, "src/outlook/company-match.ts"),
    ],
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
const contactsRoute = await load("functions/api/outlook/contacts/index.js");
const matchRoute = await load("functions/api/outlook/contacts/match.js");
const entra = await load("src/outlook/entra-config.js");
const authDetail = await load("src/outlook/auth-detail.js");
const auth = await load("functions/_lib/auth.js");
const signature = await load("src/outlook/signature.js");
const companyMatch = await load("src/outlook/company-match.js");

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
// A real page id: the route refuses anything else in a Notion path.
const NOTE_ID = "2f1c9a3e-8b7d-4c6e-9f00-1a2b3c4d5e6f";
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
    const crmAnswer = crmRoute(method, path, body);
    if (crmAnswer) return crmAnswer;
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

test("panneau : tout désélectionner passe de 27 fichiers à 0 d'un coup, puis un seul se recoche", () => {
  const many = Array.from({ length: 27 }, (_, at) => ref("m1", `f${at}`, `Pièce ${at}.pdf`, 1000 + at));
  const files = panel.candidates([message("m1", [...many, ref("m1", "cloud", "Data room", 0, { kind: "reference" })])], [], MAX);
  assert.equal(panel.chosen(files).picked.length, 27);

  const none = panel.selectAll(files, false);
  assert.equal(panel.chosen(none).picked.length, 0);
  assert.equal(none.length, 28, "rien n'est retiré de la liste");

  const one = none.map((file) => (file.id === "f4" ? { ...file, selected: true } : file));
  assert.deepEqual(panel.chosen(one).picked.map((file) => file.label), ["Pièce 4.pdf"]);

  const all = panel.selectAll(one, true);
  assert.equal(panel.chosen(all).picked.length, 27);
  assert.equal(all.find((file) => file.id === "cloud").selected, false, "un lien cloud ne se coche jamais");
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
      noteId: NOTE_ID,
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
  id: NOTE_ID,
  url: `https://notion.so/${NOTE_ID}`,
  parent: { type: "data_source_id", data_source_id: "notes-src", database_id: "notes-db" },
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

// ---- Two Entra registrations: Mosaic's and the test tenant's ---------------

const ENTRA_ENV = {
  VITE_ENTRA_CLIENT_ID: "main-client",
  VITE_ENTRA_API_SCOPE: "api://main-client/access_as_user",
  VITE_ENTRA_AUTHORITY: "https://login.microsoftonline.com/common",
  VITE_ENTRA_CLIENT_ID_TEST: "test-client",
  VITE_ENTRA_API_SCOPE_TEST: "api://test-client/access_as_user",
  VITE_ENTRA_AUTHORITY_TEST: "https://login.microsoftonline.com/test-tenant",
  VITE_ENTRA_TEST_DOMAINS: "gouman.fr, @G0uman.onmicrosoft.com",
};

test("config : une adresse Mosaic prend l'inscription principale", () => {
  const config = entra.chooseEntraConfig("ob@mosaicfin.com", ENTRA_ENV);
  assert.deepEqual(config, {
    clientId: "main-client",
    authority: "https://login.microsoftonline.com/common",
    apiScope: "api://main-client/access_as_user",
    flavour: "main",
  });
});

test("config : une adresse des domaines de test prend l'inscription _TEST, casse et @ ignorés", () => {
  for (const email of ["theo@gouman.fr", "Theo@G0UMAN.onmicrosoft.com"]) {
    const config = entra.chooseEntraConfig(email, ENTRA_ENV);
    assert.equal(config.flavour, "test", email);
    assert.equal(config.clientId, "test-client");
    assert.equal(config.apiScope, "api://test-client/access_as_user");
    assert.equal(config.authority, "https://login.microsoftonline.com/test-tenant");
  }
});

test("config : correspondance exacte du domaine, pas de sous-domaine ni de suffixe", () => {
  assert.equal(entra.chooseEntraConfig("x@mail.gouman.fr", ENTRA_ENV).flavour, "main");
  assert.equal(entra.chooseEntraConfig("x@notgouman.fr", ENTRA_ENV).flavour, "main");
  assert.equal(entra.chooseEntraConfig("", ENTRA_ENV).flavour, "main");
  assert.equal(entra.chooseEntraConfig(null, ENTRA_ENV).flavour, "main");
});

test("config : sans variables _TEST, comportement inchangé même pour un domaine de test", () => {
  const { VITE_ENTRA_CLIENT_ID_TEST, VITE_ENTRA_API_SCOPE_TEST, VITE_ENTRA_AUTHORITY_TEST, ...single } = ENTRA_ENV;
  assert.equal(entra.chooseEntraConfig("theo@gouman.fr", single).clientId, "main-client");
  // Half configured is not configured.
  assert.equal(entra.chooseEntraConfig("theo@gouman.fr", { ...single, VITE_ENTRA_CLIENT_ID_TEST: "test-client" }).flavour, "main");
});

test("config : autorité _TEST absente, « common » par défaut", () => {
  const { VITE_ENTRA_AUTHORITY_TEST, ...rest } = ENTRA_ENV;
  assert.equal(entra.chooseEntraConfig("theo@gouman.fr", rest).authority, "https://login.microsoftonline.com/common");
});

test("audience : les deux inscriptions, chacune brute et en api://", () => {
  assert.deepEqual(auth.audiencesOf({ ENTRA_API_CLIENT_ID: "main", ENTRA_API_CLIENT_ID_TEST: "test" }), [
    "main",
    "api://main",
    "test",
    "api://test",
  ]);
  assert.deepEqual(auth.audiencesOf({ ENTRA_API_CLIENT_ID: "main" }), ["main", "api://main"]);
  assert.deepEqual(auth.audiencesOf({ ENTRA_API_CLIENT_ID: "main", ENTRA_API_CLIENT_ID_TEST: " " }), ["main", "api://main"]);
});

const TEST_CLIENT = "12121212-3434-5656-7878-909090909090";
const tokenFor = (audience) =>
  new SignJWT({ tid: TENANT, oid: OID, preferred_username: "theo@gouman.fr" })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(`https://login.microsoftonline.com/${TENANT}/v2.0`)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
const limitRequest = (token) =>
  new Request("https://test/api/outlook/attachments", { headers: { authorization: `Bearer ${token}` } });

test("audience : un jeton de l'inscription de test est accepté, brut ou en api://", async () => {
  const both = { ...env, ENTRA_API_CLIENT_ID_TEST: TEST_CLIENT };
  for (const audience of [TEST_CLIENT, `api://${TEST_CLIENT}`, CLIENT]) {
    const response = await attachments.onRequestGet({ request: limitRequest(await tokenFor(audience)), env: both });
    assert.equal(response.status, 200, audience);
  }
});

test("audience : sans ENTRA_API_CLIENT_ID_TEST, le jeton de test est refusé ; une audience inconnue toujours", async () => {
  const testToken = await tokenFor(TEST_CLIENT);
  assert.equal((await attachments.onRequestGet({ request: limitRequest(testToken), env })).status, 401);
  const both = { ...env, ENTRA_API_CLIENT_ID_TEST: TEST_CLIENT };
  const stranger = await tokenFor("api://ffffffff-0000-0000-0000-000000000000");
  assert.equal((await attachments.onRequestGet({ request: limitRequest(stranger), env: both })).status, 401);
});

// ---- Sign-in failure detail ------------------------------------------------

test("détail de connexion : errorCode et errorMessage, coupé à 200 caractères sur une ligne", () => {
  const long = `AADSTS50011: The redirect URI\nspecified ${"x".repeat(300)}`;
  const detail = authDetail.authDetail({ errorCode: "invalid_request", errorMessage: long, message: "ignoré" });
  assert.ok(detail.startsWith("invalid_request — AADSTS50011: The redirect URI specified x"));
  assert.equal(detail.length, "invalid_request — ".length + 200);
  assert.ok(!detail.includes("\n"));
});

test("détail de connexion : message à défaut d'errorMessage, code seul, rien du tout", () => {
  assert.equal(authDetail.authDetail(new Error("popup_window_error")), "popup_window_error");
  assert.equal(authDetail.authDetail({ errorCode: "user_cancelled", errorMessage: "" }), "user_cancelled");
  assert.equal(authDetail.authDetail({}), null);
  assert.equal(authDetail.authDetail(null), null);
  assert.equal(authDetail.authDetail("chaîne"), null);
});

// ---- Signatures (synthetic people and companies) ---------------------------

const wrote = (address, name, text) => ({ from: { address, name }, text });

test("signature : mobile, ligne directe et fixe en 01 gardés, chacun avec ce que dit la signature", () => {
  const read = signature.readSignature(
    [
      "Bonjour,",
      "Le mandat est signé, je vous envoie la suite demain.",
      "Cordialement,",
      "Camille Exemple",
      "Directrice des investissements",
      "Foncière Lumen SAS",
      "12 rue de l'Exemple",
      "75008 Paris",
      "Mobile : +33 6 12 34 56 78",
      "Ligne directe : 01 23 45 67 89",
      "Tél. +33 (0)1 98 76 54 32",
      "Fax : 01 11 22 33 44",
      "www.fonciere-lumen.example",
    ].join("\n"),
    "Camille Exemple",
  );
  assert.deepEqual(
    read.phones.map((phone) => [phone.e164, phone.label]),
    [
      ["+33612345678", "mobile"],
      ["+33123456789", "direct"],
      ["+33198765432", "fixe"],
    ],
  );
  assert.equal(read.legalName, "Foncière Lumen SAS");
  assert.equal(read.address, "12 rue de l'Exemple, 75008 Paris");
  assert.equal(read.website, "fonciere-lumen.example");
  assert.ok(!read.lines.includes("Camille Exemple"), "le nom de la personne n'est jamais une société");
});

test("signature : un 01 seul n'est pas appelé standard ; un numéro écrit trois fois est gardé une fois", () => {
  const read = signature.readSignature("Merci\nJean Test\n01 23 45 67 89\n01.23.45.67.89\n+33 1 23 45 67 89", "Jean Test");
  assert.equal(read.phones.length, 1);
  assert.equal(read.phones[0].e164, "+33123456789");
  assert.equal(read.phones[0].label, null);
});

test("signature : international (Suisse, Royaume-Uni, 0041) et rien d'inventé dans un texte sans numéro", () => {
  const read = signature.readSignature(
    "Best regards,\nAnna Muster\nM +41 79 123 45 67\nOffice 0041 22 345 67 89\nLondon +44 20 7946 0958",
    "Anna Muster",
  );
  assert.deepEqual(
    read.phones.map((phone) => phone.e164),
    ["+41791234567", "+41223456789", "+442079460958"],
  );
  assert.equal(read.phones[0].label, "mobile");
  assert.deepEqual(signature.readSignature("Cordialement,\nPaul\nRéf. dossier 2024-118, lot 12", "Paul").phones, []);
});

test("signature : chaque numéro va à celui qui l'a écrit, sur tout le fil, pas seulement le dernier message", () => {
  const messages = [
    wrote("a@lumen.example", "Alice Un", "Bonjour\nCordialement\nAlice Un\nMobile 06 11 11 11 11\nStandard 01 40 00 00 00"),
    wrote("b@autre.example", "Bruno Deux", "Vu.\nBien à vous\nBruno Deux\n07 22 22 22 22"),
    wrote("moi@mosaic.example", "Moi", "Merci\nCordialement\nMoi\n06 99 99 99 99"),
    wrote("a@lumen.example", "Alice Un", "Ok pour moi.\nAlice"),
    wrote("A@Lumen.example", "Alice Un", "Suite\nCordialement\nAlice Un\n+33 6 11 11 11 11\nLigne directe 01 40 00 00 01"),
  ];
  const all = signature.signaturesOf(messages, ["a@lumen.example", "b@autre.example"]);
  assert.deepEqual(
    all.get("a@lumen.example").phones.map((phone) => [phone.e164, phone.label]),
    [
      ["+33611111111", "mobile"],
      ["+33140000000", "standard"],
      ["+33140000001", "direct"],
    ],
  );
  assert.deepEqual(all.get("b@autre.example").phones.map((phone) => phone.e164), ["+33722222222"]);
  assert.ok(!all.has("moi@mosaic.example"), "un interne ne reçoit rien");
});

test("signature : phoneKey rapproche les écritures d'un même numéro déjà en fiche", () => {
  assert.equal(signature.phoneKey("+33 6 12 34 56 78"), "+33612345678");
  assert.equal(signature.phoneKey("06.12.34.56.78"), "+33612345678");
  assert.equal(signature.phoneKey("0033 (0)6 12 34 56 78"), "+33612345678");
  assert.equal(signature.phoneKey("n/a"), null);
});

// ---- Company matching -------------------------------------------------------

const crm = [
  { id: "c1", name: "Foncière Lumen" },
  { id: "c2", name: "LUMEN PARTNERS SAS" },
  { id: "c3", name: "Atelier Nord" },
  { id: "c4", name: "Ateliers Nord" },
  { id: "c5", name: "Banque Exemple" },
];

test("société : le nom écrit dans la signature, casse, accents, ponctuation et forme juridique à part", () => {
  const guess = (lines, email = "x@gmail.com", website = null) =>
    companyMatch.guessCompany({ lines, website }, email, crm);
  assert.equal(guess(["FONCIERE LUMEN SAS"]).sure?.id, "c1");
  assert.equal(guess(["Lumen-Partners"]).sure?.id, "c2");
  assert.equal(guess(["Directeur · Banque  Exemple, Paris"]).sure?.id, "c5");
});

test("société : une faute ou un domaine ne font qu'une suggestion ; deux sociétés nommées, deux suggestions", () => {
  const typo = companyMatch.guessCompany({ lines: ["Fonciere Lumem"], website: null }, "x@gmail.com", crm);
  assert.equal(typo.sure, null);
  assert.deepEqual(typo.maybe.map((company) => company.id), ["c1"]);

  const domain = companyMatch.guessCompany({ lines: [], website: null }, "jean@banque-exemple.example", crm);
  assert.equal(domain.sure, null);
  assert.deepEqual(domain.maybe.map((company) => company.id), ["c5"]);

  const both = companyMatch.guessCompany({ lines: ["Atelier Nord", "Ateliers Nord"], website: null }, "x@gmail.com", crm);
  assert.equal(both.sure, null);
  assert.deepEqual(both.maybe.map((company) => company.id).sort(), ["c3", "c4"]);
});

test("société : un domaine de messagerie gratuite ne suggère rien, une ligne sans rapport non plus", () => {
  const none = companyMatch.guessCompany({ lines: ["Directrice générale"], website: null }, "lumen@gmail.com", crm);
  assert.equal(none.sure, null);
  assert.deepEqual(none.maybe, []);
});

test("société : sameCompany trouve le doublon avant création, à la forme juridique près", () => {
  assert.equal(companyMatch.sameCompany("Lumen Partners", crm)?.id, "c2");
  assert.equal(companyMatch.sameCompany("foncière lumen sarl", crm)?.id, "c1");
  assert.equal(companyMatch.sameCompany("Lumen Capital", crm), null);
});

test("signature : deux numéros sur une ligne, chacun son étiquette ; le fax écarté même en fin de ligne", () => {
  const read = signature.phonesIn(["Mobile 06 12 12 12 12 / Fixe 01 34 34 34 34", "Tél : 01 56 56 56 56 – Fax : 01 78 78 78 78", "Port. 07 90 90 90 90"]);
  assert.deepEqual(
    read.map((phone) => [phone.e164, phone.label]),
    [
      ["+33612121212", "mobile"],
      ["+33134343434", "fixe"],
      ["+33156565656", "fixe"],
      ["+33790909090", "mobile"],
    ],
  );
});

// ---- Contacts route: companies looked for before creation, numbers added ---

// A tiny CRM: a Contacts base with its phone columns and a Société relation,
// and a companies base. Synthetic names only.
const CONTACT_ID = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const fakeCrm = {
  companies: new Map(),
  contacts: new Map(),
  writes: [],
};
const resetCrm = () => {
  fakeCrm.companies = new Map([["co-1", "Foncière Lumen SAS"]]);
  fakeCrm.contacts = new Map([
    [
      CONTACT_ID,
      {
        parent: { data_source_id: "contacts-src" },
        properties: {
          Nom: { type: "title", title: [{ plain_text: "Camille Exemple" }] },
          Email: { type: "email", email: "camille@lumen.example" },
          Société: { type: "relation", relation: [{ id: "co-1" }] },
          "Téléphone FR": { type: "phone_number", phone_number: "06 12 34 56 78" },
          Téléphone: { type: "phone_number", phone_number: null },
        },
      },
    ],
  ]);
  fakeCrm.writes = [];
};

const CONTACTS_SCHEMA = {
  Nom: { id: "n", name: "Nom", type: "title" },
  Email: { id: "e", name: "Email", type: "email" },
  Société: { id: "s", name: "Société", type: "relation", relation: { data_source_id: "companies-src" } },
  "Téléphone FR": { id: "tf", name: "Téléphone FR", type: "phone_number" },
  "Téléphone CH": { id: "tc", name: "Téléphone CH", type: "phone_number" },
  Téléphone: { id: "t", name: "Téléphone", type: "phone_number" },
  Type: { id: "ty", name: "Type", type: "multi_select", multi_select: { options: [] } },
};
const COMPANIES_SCHEMA = {
  Nom: { id: "cn", name: "Nom", type: "title" },
  Adresse: { id: "ca", name: "Adresse", type: "rich_text" },
};

function crmRoute(method, path, body) {
  if (path === "/v1/databases/contacts-db") return reply({ data_sources: [{ id: "contacts-src" }] });
  if (path === "/v1/data_sources/contacts-src") return reply({ properties: CONTACTS_SCHEMA });
  if (path === "/v1/data_sources/companies-src") return reply({ properties: COMPANIES_SCHEMA });
  if (path === "/v1/data_sources/companies-src/query") {
    return reply({
      results: [...fakeCrm.companies].map(([id, name]) => ({ id, properties: { Nom: { type: "title", title: [{ plain_text: name }] } } })),
      has_more: false,
    });
  }
  if (path === "/v1/data_sources/contacts-src/query") {
    return reply({ results: [...fakeCrm.contacts].map(([id, held]) => ({ id, ...held })), has_more: false });
  }
  if (path === "/v1/pages" && method === "POST") {
    const created = JSON.parse(body);
    fakeCrm.writes.push({ method, path, body: created });
    const id = `new-${fakeCrm.writes.length}`;
    if (created.parent.data_source_id === "companies-src") fakeCrm.companies.set(id, created.properties.title.title[0].text.content);
    return reply({ id });
  }
  const contact = path.match(/^\/v1\/pages\/(.+)$/);
  if (contact && fakeCrm.contacts.has(contact[1])) {
    if (method === "GET") return reply(fakeCrm.contacts.get(contact[1]));
    if (method === "PATCH") {
      const { properties } = JSON.parse(body);
      fakeCrm.writes.push({ method, path, body: properties });
      for (const [name, value] of Object.entries(properties)) fakeCrm.contacts.get(contact[1]).properties[name] = { type: "phone_number", ...value };
      return reply({ id: contact[1] });
    }
  }
  return null;
}

const crmRequest = (method, path, body) =>
  new Request(`https://test${path}`, {
    method,
    headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("contact Outlook : une société déjà au CRM, écrite autrement, est reprise et pas recréée", async () => {
  resetCrm();
  const response = await contactsRoute.onRequestPost({
    request: crmRequest("POST", "/api/outlook/contacts", {
      name: "Jean Test",
      email: "jean@lumen.example",
      newCompany: { name: "FONCIERE-LUMEN", address: "12 rue de l'Exemple, 75008 Paris" },
    }),
    env,
  });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.companyId, "co-1");
  assert.equal(result.company, "Foncière Lumen SAS");
  const companyWrites = fakeCrm.writes.filter((write) => write.body.parent?.data_source_id === "companies-src");
  assert.equal(companyWrites.length, 0, "aucune société créée");
  const contactWrite = fakeCrm.writes.find((write) => write.body.parent?.data_source_id === "contacts-src");
  assert.deepEqual(contactWrite.body.properties.Société, { relation: [{ id: "co-1" }] });
});

test("contact Outlook : une société nouvelle est créée avec le nom et l'adresse donnés, rien d'autre", async () => {
  resetCrm();
  const response = await contactsRoute.onRequestPost({
    request: crmRequest("POST", "/api/outlook/contacts", {
      name: "Anna Muster",
      email: "anna@atelier.example",
      phones: [
        { country: "CH", dial: "+41", number: "79 123 45 67" },
        { country: "FR", dial: "+33", number: "1 23 45 67 89" },
      ],
      newCompany: { name: "Atelier Nord SA", address: "Rue du Test 4, 1201 Genève" },
    }),
    env,
  });
  assert.equal(response.status, 201);
  const [company, contact] = fakeCrm.writes;
  assert.equal(company.body.parent.data_source_id, "companies-src");
  assert.deepEqual(Object.keys(company.body.properties).sort(), ["Adresse", "title"]);
  assert.equal(company.body.properties.Adresse.rich_text[0].text.content, "Rue du Test 4, 1201 Genève");
  assert.equal(contact.body.properties["Téléphone CH"].phone_number, "+41 79 123 45 67");
  assert.equal(contact.body.properties["Téléphone FR"].phone_number, "+33 1 23 45 67 89");
  assert.equal((await response.json()).companyId, "new-1");
});

test("contact Outlook : les numéros ajoutés à une fiche s'ajoutent, ceux qu'elle a déjà ne bougent pas", async () => {
  resetCrm();
  const response = await contactsRoute.onRequestPatch({
    request: crmRequest("PATCH", "/api/outlook/contacts", {
      id: CONTACT_ID,
      phones: [
        { country: "FR", dial: "+33", number: "6 12 34 56 78" },
        { country: "FR", dial: "+33", number: "1 40 00 00 00" },
        { country: "GB", dial: "+44", number: "20 7946 0958" },
      ],
    }),
    env,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { added: 2 });
  const [patch] = fakeCrm.writes;
  assert.equal(patch.body["Téléphone FR"].phone_number, "06 12 34 56 78 / +33 1 40 00 00 00");
  assert.equal(patch.body["Téléphone"].phone_number, "+44 20 7946 0958");

  // Again: nothing left to add, nothing written.
  fakeCrm.writes = [];
  const again = await contactsRoute.onRequestPatch({
    request: crmRequest("PATCH", "/api/outlook/contacts", {
      id: CONTACT_ID,
      phones: [{ country: "FR", dial: "+33", number: "1 40 00 00 00" }],
    }),
    env,
  });
  assert.deepEqual(await again.json(), { added: 0 });
  assert.equal(fakeCrm.writes.length, 0);
});

test("contact Outlook : PATCH refuse un id qui n'est pas une page de la base Contacts", async () => {
  resetCrm();
  const bad = await contactsRoute.onRequestPatch({
    request: crmRequest("PATCH", "/api/outlook/contacts", { id: "../users/me", phones: [{ country: "FR", number: "06 00 00 00 00" }] }),
    env,
  });
  assert.equal(bad.status, 400);
  const empty = await contactsRoute.onRequestPatch({
    request: crmRequest("PATCH", "/api/outlook/contacts", { id: CONTACT_ID, phones: [] }),
    env,
  });
  assert.equal(empty.status, 400);
});

test("reconnaissance : un contact connu revient avec les numéros de sa fiche", async () => {
  resetCrm();
  const response = await matchRoute.onRequestPost({
    request: crmRequest("POST", "/api/outlook/contacts/match", { addresses: ["camille@lumen.example"] }),
    env,
  });
  const body = await response.json();
  assert.deepEqual(body.matched["camille@lumen.example"].phones, ["06 12 34 56 78"]);
  assert.equal(body.matched["camille@lumen.example"].company, "Foncière Lumen SAS");
});
