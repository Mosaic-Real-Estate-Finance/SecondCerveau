// End to end runs of the Read AI sync against an in-memory Notion and an
// in-memory Upstash, through the real modules.
//
// The unit tests (test-readai.mjs) cover the pure rules. This covers what
// only shows when the pieces meet: the queue, the merge of two reports, two
// colleagues deciding at once, Notion going down and the retry after it, the
// webhook's own answers. Neither Notion nor Redis is reached: `fetch` is
// replaced for the process, and both fakes refuse what the real APIs refuse
// that matters here (100 blocks per append, the select option, nesting).
//
//   npm run sim:readai

import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const out = mkdtempSync(join(tmpdir(), "mosaic-sim-"));
writeFileSync(
  join(out, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: { target: "ES2023", module: "nodenext", moduleResolution: "nodenext", skipLibCheck: true, outDir: join(out, "dist"), rootDir: root },
    include: [join(root, "functions")],
  }),
);
try {
  execFileSync("npx", ["tsc", "-p", join(out, "tsconfig.json")], { cwd: root, stdio: "pipe" });
} catch {
  // Emitted anyway.
}
const dist = join(out, "dist");
writeFileSync(join(dist, "package.json"), JSON.stringify({ type: "module" }));
symlinkSync(join(root, "node_modules"), join(dist, "node_modules"));

// ---- Fake Upstash -------------------------------------------------------------

const store = new Map(); // key -> { type, value, expires }
const now = () => Date.now();
function entry(key) {
  const held = store.get(key);
  if (held && held.expires && held.expires <= now()) {
    store.delete(key);
    return undefined;
  }
  return held;
}
const RELEASE_SCRIPT_PREFIX = 'if redis.call("get", KEYS[1]) == ARGV[1]';

function command([name, ...args]) {
  const op = String(name).toUpperCase();
  switch (op) {
    case "SET": {
      const [key, value, ...flags] = args;
      const upper = flags.map((flag) => String(flag).toUpperCase());
      const held = entry(key);
      if (upper.includes("NX") && held) return null;
      let expires = 0;
      const ex = upper.indexOf("EX");
      if (ex >= 0) expires = now() + Number(flags[ex + 1]) * 1000;
      if (upper.includes("KEEPTTL") && held) expires = held.expires;
      store.set(key, { type: "string", value: String(value), expires });
      return "OK";
    }
    case "GET":
      return entry(args[0])?.value ?? null;
    case "MGET":
      return args.map((key) => entry(key)?.value ?? null);
    case "DEL":
      return args.reduce((count, key) => count + (store.delete(key) ? 1 : 0), 0);
    case "EXISTS":
      return args.filter((key) => entry(key)).length;
    case "INCR": {
      const held = entry(args[0]);
      const value = Number(held?.value ?? 0) + 1;
      store.set(args[0], { type: "string", value: String(value), expires: held?.expires ?? 0 });
      return value;
    }
    case "EXPIRE": {
      const held = entry(args[0]);
      if (!held) return 0;
      held.expires = now() + Number(args[1]) * 1000;
      return 1;
    }
    case "SADD": {
      const held = entry(args[0]) ?? { type: "set", value: new Set(), expires: 0 };
      store.set(args[0], held);
      let added = 0;
      for (const member of args.slice(1)) if (!held.value.has(String(member)) && held.value.add(String(member))) added++;
      return added;
    }
    case "SREM": {
      const held = entry(args[0]);
      return held ? args.slice(1).filter((member) => held.value.delete(String(member))).length : 0;
    }
    case "SMEMBERS":
      return [...(entry(args[0])?.value ?? [])];
    case "HSET": {
      const held = entry(args[0]) ?? { type: "hash", value: new Map(), expires: 0 };
      store.set(args[0], held);
      for (let at = 1; at < args.length; at += 2) held.value.set(String(args[at]), String(args[at + 1]));
      return (args.length - 1) / 2;
    }
    case "HDEL": {
      const held = entry(args[0]);
      return held ? args.slice(1).filter((field) => held.value.delete(String(field))).length : 0;
    }
    case "HGETALL": {
      const held = entry(args[0]);
      return held ? [...held.value.entries()].flat() : [];
    }
    case "ZADD": {
      const held = entry(args[0]) ?? { type: "zset", value: new Map(), expires: 0 };
      store.set(args[0], held);
      for (let at = 1; at < args.length; at += 2) held.value.set(String(args[at + 1]), Number(args[at]));
      return 1;
    }
    case "ZREM": {
      const held = entry(args[0]);
      return held ? args.slice(1).filter((member) => held.value.delete(String(member))).length : 0;
    }
    case "ZCARD":
      return entry(args[0])?.value.size ?? 0;
    case "ZRANGE": {
      const held = entry(args[0]);
      if (!held) return [];
      const sorted = [...held.value.entries()].sort((a, b) => a[1] - b[1]).map(([member]) => member);
      if (args.map((arg) => String(arg).toUpperCase()).includes("REV")) sorted.reverse();
      return sorted;
    }
    case "EVAL": {
      const [script, , key, value] = args;
      if (!String(script).startsWith(RELEASE_SCRIPT_PREFIX)) throw new Error("script inconnu");
      if (entry(key)?.value === String(value)) return store.delete(key) ? 1 : 0;
      return 0;
    }
    default:
      throw new Error(`commande non simulée : ${op}`);
  }
}

const b64 = (value) =>
  typeof value === "string"
    ? Buffer.from(value).toString("base64")
    : Array.isArray(value)
      ? value.map(b64)
      : value;

let redisDown = false;
async function fakeRedis(url, init) {
  if (redisDown) return new Response("down", { status: 503 });
  const body = JSON.parse(init.body);
  const encode = new Headers(init.headers).get("upstash-encoding") === "base64";
  const one = (cmd) => {
    try {
      const result = command(cmd);
      return { result: encode ? b64(result) : result };
    } catch (error) {
      return { error: error.message };
    }
  };
  const path = new URL(url).pathname;
  if (path.endsWith("/pipeline") || path.endsWith("/multi-exec")) return Response.json(body.map(one));
  return Response.json(one(body));
}

// ---- Fake Notion -------------------------------------------------------------

const schemas = {
  "ds-notes": {
    Sujet: { id: "Sujet", name: "Sujet", type: "title" },
    Date: { id: "Date", name: "Date", type: "date" },
    Auteur: { id: "Auteur", name: "Auteur", type: "people" },
    Interlocuteur: { id: "Interlocuteur", name: "Interlocuteur", type: "relation", relation: { data_source_id: "ds-contacts" } },
    "ID client": { id: "ID client", name: "ID client", type: "rich_text" },
    Source: { id: "Source", name: "Source", type: "select", select: { options: [{ name: "Dictée" }, { name: "Email" }, { name: "ReadAI" }] } },
    "Statut IA": { id: "Statut IA", name: "Statut IA", type: "select", select: { options: [] } },
  },
  "ds-contacts": {
    "": { id: "title", name: "", type: "title" },
    Email: { id: "Email", name: "Email", type: "email" },
    Société: { id: "Société", name: "Société", type: "relation", relation: { data_source_id: "ds-companies" } },
  },
  "ds-companies": { Nom: { id: "Nom", name: "Nom", type: "title" } },
};
const databases = { "db-notes": "ds-notes", "db-contacts": "ds-contacts", "db-companies": "ds-companies" };
const pages = new Map();
const blocks = new Map(); // id -> { children: [] }
let notionDown = false;
let calls = 0;

function stored(ds, key, value) {
  const schema = schemas[ds];
  const property = key === "title" ? Object.values(schema).find((p) => p.type === "title") : schema[key];
  if (!property) throw Object.assign(new Error(`propriété inconnue ${key}`), { status: 400 });
  switch (property.type) {
    case "title":
      return [property.name, { type: "title", title: value.title.map((part) => ({ plain_text: part.text.content })) }];
    case "rich_text":
      return [property.name, { type: "rich_text", rich_text: value.rich_text.map((part) => ({ plain_text: part.text.content })) }];
    case "email":
      return [property.name, { type: "email", email: value.email }];
    case "relation":
      return [property.name, { type: "relation", relation: value.relation.map(({ id }) => ({ id })) }];
    case "people":
      return [property.name, { type: "people", people: value.people.map(({ id }) => ({ id })) }];
    case "date":
      return [property.name, { type: "date", date: value.date }];
    case "select": {
      // The real API would create a missing option; the code must never ask it to.
      if (!property.select.options.some((option) => option.name === value.select.name)) {
        throw Object.assign(new Error(`option absente ${value.select.name}`), { status: 400 });
      }
      return [property.name, { type: "select", select: value.select }];
    }
    default:
      return [property.name, { type: property.type, ...value }];
  }
}

function addPage(ds, properties) {
  const id = randomUUID();
  const page = { id, url: `https://www.notion.so/${id.replace(/-/g, "")}`, ds, in_trash: false, properties: {} };
  for (const [key, value] of Object.entries(properties)) {
    const [name, prop] = stored(ds, key, value);
    page.properties[name] = prop;
  }
  pages.set(id, page);
  blocks.set(id, { children: [] });
  return page;
}

const plainOf = (prop) =>
  prop?.type === "email" ? (prop.email ?? "") : (prop?.[prop?.type] ?? []).map((part) => part.plain_text ?? "").join("");

function matches(page, filter) {
  if (!filter) return true;
  if (filter.or) return filter.or.some((one) => matches(page, one));
  const value = plainOf(page.properties[filter.property]);
  const test = filter.email ?? filter.rich_text;
  if (test.contains !== undefined) return value.includes(test.contains);
  if (test.equals !== undefined) return value === test.equals;
  return false;
}

function size(block) {
  const body = block[block.type] ?? {};
  return 1 + (body.children ?? []).reduce((total, child) => total + size(child), 0);
}
function depth(block) {
  const body = block[block.type] ?? {};
  return 1 + Math.max(0, ...(body.children ?? []).map(depth));
}

async function fakeNotion(url, init = {}) {
  calls++;
  if (notionDown) return Response.json({ message: "Service indisponible" }, { status: 503 });
  const { pathname } = new URL(url);
  const path = pathname.replace(/^\/v1/, "");
  const method = init.method ?? "GET";
  const body = init.body ? JSON.parse(init.body) : {};
  try {
    let match;
    if ((match = /^\/databases\/([^/]+)$/.exec(path))) return Response.json({ data_sources: [{ id: databases[match[1]] }] });
    if ((match = /^\/data_sources\/([^/]+)$/.exec(path))) return Response.json({ properties: schemas[match[1]] });
    if ((match = /^\/data_sources\/([^/]+)\/query$/.exec(path))) {
      const results = [...pages.values()].filter((page) => page.ds === match[1] && !page.in_trash && matches(page, body.filter));
      return Response.json({ results: results.slice(0, body.page_size ?? 100), has_more: false, next_cursor: null });
    }
    if (path === "/pages" && method === "POST") return Response.json(addPage(body.parent.data_source_id, body.properties));
    if ((match = /^\/pages\/([^/]+)$/.exec(path))) {
      const page = pages.get(match[1]);
      if (!page) return Response.json({ message: "introuvable" }, { status: 404 });
      if (method === "PATCH") {
        if (body.in_trash !== undefined) page.in_trash = body.in_trash;
        for (const [key, value] of Object.entries(body.properties ?? {})) {
          const [name, prop] = stored(page.ds, key, value);
          page.properties[name] = prop;
        }
      }
      return Response.json(page);
    }
    if ((match = /^\/pages\/([^/]+)\/properties\/([^/]+)$/.exec(path))) {
      const page = pages.get(match[1]);
      const prop = page.properties[decodeURIComponent(match[2])];
      const items = (prop?.[prop.type] ?? []).map((item) => ({ type: prop.type, [prop.type]: item }));
      return Response.json({ results: items, has_more: false });
    }
    if ((match = /^\/blocks\/([^/]+)\/children$/.exec(path)) && method === "PATCH") {
      const parent = blocks.get(match[1]);
      if (!parent) return Response.json({ message: "bloc introuvable" }, { status: 404 });
      const children = body.children ?? [];
      if (children.reduce((total, child) => total + size(child), 0) > 100) {
        return Response.json({ message: "plus de 100 blocs" }, { status: 400 });
      }
      if (children.some((child) => depth(child) > 2)) return Response.json({ message: "imbrication" }, { status: 400 });
      const made = children.map((child) => {
        const id = randomUUID();
        const nested = child[child.type]?.children ?? [];
        blocks.set(id, { ...child, id, children: [...nested] });
        return { id, type: child.type };
      });
      parent.children.push(...made.map(({ id }) => blocks.get(id)));
      return Response.json({ results: made });
    }
    return Response.json({ message: `route non simulée ${method} ${path}` }, { status: 400 });
  } catch (error) {
    return Response.json({ message: error.message }, { status: error.status ?? 500 });
  }
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.startsWith("https://api.notion.com")) return fakeNotion(url, init);
  if (url.startsWith("https://fake-redis")) return fakeRedis(url, init);
  return realFetch(input, init);
};

// ---- Data -------------------------------------------------------------------

const gouman = addPage("ds-companies", { Nom: { title: [{ text: { content: "Gouman" } }] } });
const holding = addPage("ds-companies", { Nom: { title: [{ text: { content: "Holding" } }] } });
const filiale = addPage("ds-companies", { Nom: { title: [{ text: { content: "Filiale" } }] } });
const contact = (name, email, company) =>
  addPage("ds-contacts", {
    title: { title: [{ text: { content: name } }] },
    Email: { email },
    ...(company ? { Société: { relation: [{ id: company.id }] } } : {}),
  });
const theo = contact("Théo Gouman", "theo@gouman.fr", gouman);
const claire = contact("Claire Client", "claire@client.fr, c.client@perso.fr", null);
contact("Anne Holding", "anne@groupe.fr", holding);
contact("Bob Filiale", "bob@groupe.fr", filiale);
contact("Double Un", "double@x.fr", null);
contact("Double Deux", "double@x.fr", null);

const SECRET = Buffer.from("cle-de-signature-de-test-32-octets!").toString("base64");
const env = {
  NOTION_TOKEN: "ntn_fake",
  NOTION_CONTACTS_DB: "db-contacts",
  NOTION_NOTES_DB: "db-notes",
  NOTES_PROP_CLIENT_ID: "ID client",
  INTERNAL_DOMAINS: "mosaicfin.com",
  READAI_WEBHOOK_SECRET: SECRET,
  KV_REST_API_URL: "https://fake-redis",
  KV_REST_API_TOKEN: "fake",
  SESSION_SECRET: "une-cle-de-session-de-test-assez-longue",
};

const lib = (path) => import(pathToFileURL(join(dist, path)).href);
const { processMeeting, retry } = await lib("functions/_lib/readai/process.js");
const queue = await lib("functions/_lib/readai/queue.js");
const { parseMeeting } = await lib("functions/_lib/readai/payload.js");
const webhook = (await lib("functions/api/readai/webhook.js")).onRequestPost;
const auth = (await lib("functions/api/auth.js")).onRequestPost;
const session = await lib("functions/api/session.js");
const contacts = await lib("functions/api/contacts.js");
const screen = await lib("functions/api/readai/screen.js");

const user = { email: "ob@mosaicfin.com", firstName: "Oscar", notionUserId: "fab25539-5e5f-4766-af3a-14397eda089f" };
const T0 = Date.parse("2026-10-08T09:00:00Z");
let serial = 0;
const report = ({ title = "Point dossier", start = T0, people, platformId = null, session: sessionId, turns = 4 } = {}) => {
  serial++;
  return {
    session_id: sessionId ?? `S${serial}`,
    trigger: "meeting_end",
    title,
    start_time: new Date(start).toISOString(),
    end_time: new Date(start + 3_600_000).toISOString(),
    participants: people.map(([name, email]) => ({ name, first_name: name.split(" ")[0], last_name: name.split(" ").slice(1).join(" "), email })),
    owner: { name: "Oscar B", first_name: "Oscar", last_name: "B", email: "ob@mosaicfin.com" },
    summary: "Ligne un du résumé.\nLigne deux.",
    transcript: {
      speaker_blocks: Array.from({ length: turns }, (_, index) => ({
        start_time: String(start + index * 5_500),
        end_time: "0",
        speaker: { name: index % 2 ? "Oscar B" : "Interlocuteur" },
        words: `Intervention ${index + 1}`,
      })),
    },
    platform: "zoom",
    platform_meeting_id: platformId,
    request_id: randomUUID(),
  };
};
const notesFor = (key) => [...pages.values()].filter((page) => page.ds === "ds-notes" && !page.in_trash && plainOf(page.properties["ID client"]) === key);
const allNotes = () => [...pages.values()].filter((page) => page.ds === "ds-notes" && !page.in_trash);
const contactIdsOf = (note) => note.properties.Interlocuteur.relation.map(({ id }) => id).sort();
const flatText = (blockId) => blocks.get(blockId).children.map((child) => child[child.type].rich_text.map((part) => part.text.content).join(""));
const items = () => queue.listItems(env);

const results = [];
async function scenario(name, run) {
  try {
    await run();
    results.push(["ok", name]);
    console.log(`  ok     ${name}`);
  } catch (error) {
    results.push(["fail", name]);
    console.log(`  ÉCHEC  ${name}\n         ${error.message.split("\n").join("\n         ")}`);
  }
}

console.log("Simulation Read AI → Notion\n");

// ---- Webhook -----------------------------------------------------------------

const post = (body, signature) =>
  webhook({
    request: new Request("http://x/api/readai/webhook", {
      method: "POST",
      headers: signature === undefined ? {} : { "x-read-signature": signature },
      body,
    }),
    env,
  });
const sign = (body) => createHmac("sha256", Buffer.from(SECRET, "base64")).update(body).digest("hex");

await scenario("webhook : sans signature ou signature fausse → 401", async () => {
  const body = JSON.stringify(report({ people: [["Théo", "theo@gouman.fr"]] }));
  assert.equal((await post(body)).status, 401);
  assert.equal((await post(body, "00".repeat(32))).status, 401);
});

await scenario("webhook : meeting_start → 200 sans effet", async () => {
  const before = allNotes().length;
  const body = JSON.stringify({ ...report({ people: [["Théo", "theo@gouman.fr"]] }), trigger: "meeting_start" });
  const response = await post(body, sign(body));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ignored, "trigger");
  assert.equal(allNotes().length, before);
});

await scenario("webhook : réponse < 2 s pour une réunion d'une heure, puis note ; même request_id → doublon", async () => {
  const payload = report({ title: "Une heure", people: [["Théo Gouman", "theo@gouman.fr"]], turns: 640, platformId: "hour-1" });
  const body = JSON.stringify(payload);
  const started = performance.now();
  const response = await post(body, sign(body));
  const elapsed = performance.now() - started;
  assert.equal(response.status, 200);
  assert.ok(elapsed < 2000, `réponse en ${Math.round(elapsed)} ms`);
  const again = await post(body, sign(body));
  assert.equal((await again.json()).duplicate, true);
  // The processing runs after the answer: wait for it.
  for (let i = 0; i < 200 && !notesFor("readai:zoom:hour-1").length; i++) await new Promise((r) => setTimeout(r, 50));
  for (let i = 0; i < 200; i++) {
    const note = notesFor("readai:zoom:hour-1")[0];
    const transcript = note && blocks.get(note.id).children[1];
    if (transcript && transcript.children.length === 640) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const notes = notesFor("readai:zoom:hour-1");
  assert.equal(notes.length, 1, "une seule note");
  const [summary, transcript] = blocks.get(notes[0].id).children;
  assert.equal(blocks.get(notes[0].id).children.length, 2, "deux callouts et rien d'autre");
  assert.equal(summary.callout.rich_text[0].text.content, "Résumé");
  assert.equal(transcript.callout.rich_text[0].text.content, "Transcription");
  const lines = flatText(transcript.id);
  assert.equal(lines.length, 640, "transcription entière");
  assert.ok(lines.every((line, index) => line.endsWith(`Intervention ${index + 1}`)), "dans l'ordre");
  assert.ok(lines[1].startsWith("Oscar B (00:05) — "), lines[1]);
});

// ---- Filtering ---------------------------------------------------------------

await scenario("filtrage : réunion interne seulement → rien", async () => {
  const before = { notes: allNotes().length, items: (await items()).length };
  const outcome = await processMeeting(env, parseMeeting(report({ people: [["Philippe", "pb@mosaicfin.com"]] })));
  assert.equal(outcome, "ignored");
  assert.deepEqual({ notes: allNotes().length, items: (await items()).length }, before);
});

await scenario("filtrage : externes sans email → rien", async () => {
  assert.equal(await processMeeting(env, parseMeeting(report({ people: [["Sans Mail", null]] }))), "ignored");
});

await scenario("filtrage : tous reconnus → note directe, auteurs, Source ReadAI, ID client, sans Statut IA", async () => {
  const payload = report({ people: [["Théo", "theo@gouman.fr"], ["Claire", "c.client@perso.fr"], ["Xavier", "xn@mosaicfin.com"]], platformId: "direct-1" });
  assert.equal(await processMeeting(env, parseMeeting(payload)), "noted");
  const [note] = notesFor("readai:zoom:direct-1");
  assert.deepEqual(contactIdsOf(note), [theo.id, claire.id].sort());
  assert.equal(note.properties.Source.select.name, "ReadAI");
  assert.equal(note.properties.Date.date.start, payload.start_time);
  assert.equal(note.properties.Auteur.people.length, 2, "Oscar (owner) et Xavier");
  assert.equal(note.properties["Statut IA"], undefined);
  assert.equal(note.properties.Sujet.title[0].plain_text, "Point dossier");
});

// ---- Queue -------------------------------------------------------------------

await scenario("file : un connu + un inconnu → rien dans Notion, file ; arsene@gouman.fr → Gouman suggérée", async () => {
  const before = allNotes().length;
  const payload = report({ title: "Avec Arsène", people: [["Théo", "theo@gouman.fr"], ["Arsène G", "arsene@gouman.fr"]], platformId: "q-1" });
  assert.equal(await processMeeting(env, parseMeeting(payload)), "queued");
  assert.equal(allNotes().length, before, "rien dans Notion");
  const item = (await items()).find((one) => one.key === "readai:zoom:q-1");
  assert.deepEqual(item.recognized.map((c) => c.id), [theo.id]);
  assert.equal(item.people.length, 1);
  assert.deepEqual(item.people[0].companies.map((c) => c.name), ["Gouman"]);
  assert.equal(item.meeting.blocks, undefined, "la transcription ne part pas vers l'écran");
});

await scenario("file : créer le contact → note avec les deux contacts, contenu effacé de Redis", async () => {
  const item = (await items()).find((one) => one.key === "readai:zoom:q-1");
  const result = await queue.decide(env, user, item.id, "arsene@gouman.fr", {
    action: "create",
    contact: { name: "Arsène G", companyId: gouman.id, email: "pirate@ailleurs.fr" },
  });
  assert.equal(result.closed, true);
  const [note] = notesFor("readai:zoom:q-1");
  const arsene = [...pages.values()].find((page) => page.ds === "ds-contacts" && plainOf(page.properties[""]) === "Arsène G");
  assert.equal(arsene.properties.Email.email, "arsene@gouman.fr", "l'adresse de la personne, pas celle du formulaire");
  assert.deepEqual(contactIdsOf(note), [theo.id, arsene.id].sort());
  assert.equal(store.has(`readai:item:${item.id}`), false);
  assert.equal(store.has(`readai:meeting:readai:zoom:q-1`), false);
});

await scenario("rapprochement : @gmail.com inconnu sans suggestion ; domaine sur deux sociétés → les deux ; doublon → deux candidats", async () => {
  const payload = report({ title: "Divers", people: [["G", "inconnu@gmail.com"], ["C", "carl@groupe.fr"], ["D", "double@x.fr"]], platformId: "q-2" });
  await processMeeting(env, parseMeeting(payload));
  const item = (await items()).find((one) => one.key === "readai:zoom:q-2");
  const byEmail = Object.fromEntries(item.people.map((person) => [person.email, person]));
  assert.deepEqual(byEmail["inconnu@gmail.com"].companies, []);
  assert.deepEqual(byEmail["carl@groupe.fr"].companies.map((c) => c.name).sort(), ["Filiale", "Holding"]);
  assert.equal(byEmail["double@x.fr"].candidates.length, 2);
});

await scenario("décisions : rattacher ajoute l'adresse ; pas nécessaire exclut ; puis appel suivant direct", async () => {
  const item = (await items()).find((one) => one.key === "readai:zoom:q-2");
  await queue.decide(env, user, item.id, "carl@groupe.fr", { action: "attach", contactId: claire.id });
  assert.equal(claire.properties.Email.email, "claire@client.fr, c.client@perso.fr, carl@groupe.fr");
  await queue.decide(env, user, item.id, "inconnu@gmail.com", { action: "exclude" });
  const double = item.people.find((p) => p.email === "double@x.fr").candidates[0];
  const result = await queue.decide(env, user, item.id, "double@x.fr", { action: "attach", contactId: double.id });
  assert.equal(result.closed, true);
  const next = report({ title: "Suite", people: [["C", "carl@groupe.fr"], ["G", "inconnu@gmail.com"]], platformId: "q-3" });
  assert.equal(await processMeeting(env, parseMeeting(next)), "noted", "Carl reconnu, Gmail exclu : aucune question");
});

await scenario("décisions : déjà traité → 409 ; ignorer → rien et personne exclu", async () => {
  await processMeeting(env, parseMeeting(report({ title: "Ignorée", people: [["Z", "zoe@nouvelle.fr"]], platformId: "q-4" })));
  const item = (await items()).find((one) => one.key === "readai:zoom:q-4");
  await queue.decide(env, user, item.id, "zoe@nouvelle.fr", { action: "exclude" }).catch(() => undefined);
  // Excluding the only person settles the call: no contact, so no note.
  assert.equal(notesFor("readai:zoom:q-4").length, 0, "tout « pas nécessaire » → aucune note");
  await assert.rejects(queue.decide(env, user, item.id, "zoe@nouvelle.fr", { action: "exclude" }), /déjà été traité|Déjà traité/);
  await queue.removeExcluded(env, "zoe@nouvelle.fr");
  await processMeeting(env, parseMeeting(report({ title: "Ignorée 2", people: [["Y", "yves@nouvelle.fr"]], platformId: "q-5" })));
  const other = (await items()).find((one) => one.key === "readai:zoom:q-5");
  await queue.ignore(env, other.id);
  assert.equal(notesFor("readai:zoom:q-5").length, 0);
  assert.equal((await queue.excludedList(env)).includes("yves@nouvelle.fr"), false);
  assert.equal(store.has(`readai:item:${other.id}`), false);
});

// ---- Concurrency ---------------------------------------------------------------

await scenario("concurrence : deux validations simultanées → un seul contact, l'autre « Déjà traité »", async () => {
  await processMeeting(env, parseMeeting(report({ title: "Course", people: [["Léa N", "lea@neuve.fr"], ["Théo", "theo@gouman.fr"]], platformId: "c-1" })));
  const item = (await items()).find((one) => one.key === "readai:zoom:c-1");
  const before = [...pages.values()].filter((page) => page.ds === "ds-contacts").length;
  const attempt = () =>
    queue.decide(env, user, item.id, "lea@neuve.fr", { action: "create", contact: { name: "Léa N" } }).then(
      () => "ok",
      (error) => error.message,
    );
  const outcomes = await Promise.all([attempt(), attempt()]);
  const after = [...pages.values()].filter((page) => page.ds === "ds-contacts").length;
  assert.equal(after - before, 1, `contacts créés : ${after - before}`);
  assert.ok(outcomes.includes("ok") && outcomes.some((o) => o !== "ok"), JSON.stringify(outcomes));
  assert.equal(notesFor("readai:zoom:c-1").length, 1);
});

await scenario("dédoublonnage : deux rapports à la même seconde → un élément, deux auteurs", async () => {
  const people = [["Mia", "mia@inconnue.fr"], ["Philippe", "pb@mosaicfin.com"]];
  const first = report({ title: "Double", people, platformId: "d-1" });
  const second = { ...report({ title: "Double", people, platformId: "d-1" }), owner: { name: "Xavier", email: "xn@mosaicfin.com" } };
  const outcomes = await Promise.all([processMeeting(env, parseMeeting(first)), processMeeting(env, parseMeeting(second))]);
  assert.deepEqual(outcomes.sort(), ["merged", "queued"]);
  const matching = (await items()).filter((one) => one.key === "readai:zoom:d-1");
  assert.equal(matching.length, 1);
  assert.equal(matching[0].authors.length, 3, "Oscar, Philippe, Xavier");
  await queue.decide(env, user, matching[0].id, "mia@inconnue.fr", { action: "create", contact: { name: "Mia" } });
  const [note] = notesFor("readai:zoom:d-1");
  assert.equal(note.properties.Auteur.people.length, 3);
});

await scenario("dédoublonnage : note déjà créée → auteurs et contacts ajoutés, élément « compléter » pour l'inconnu", async () => {
  const later = { ...report({ title: "Point dossier", people: [["Théo", "theo@gouman.fr"], ["Claire", "claire@client.fr"], ["Nouveau", "nouveau@client.fr"]], platformId: "direct-1" }), owner: { name: "Xavier", email: "xn@mosaicfin.com" } };
  const [note] = notesFor("readai:zoom:direct-1");
  const bodyBefore = blocks.get(note.id).children.length;
  assert.equal(await processMeeting(env, parseMeeting(later)), "merged");
  assert.equal(notesFor("readai:zoom:direct-1").length, 1);
  assert.equal(blocks.get(note.id).children.length, bodyBefore, "contenu non réécrit");
  const item = (await items()).find((one) => one.key === "readai:zoom:direct-1");
  assert.equal(item.kind, "complete");
  await queue.decide(env, user, item.id, "nouveau@client.fr", { action: "attach", contactId: claire.id });
  assert.ok(contactIdsOf(notesFor("readai:zoom:direct-1")[0]).includes(claire.id));
});

await scenario("dédoublonnage : app Read sans identifiant + robot Zoom, 4 min d'écart → même réunion", async () => {
  const people = [["Nina", "nina@client2.fr"]];
  await processMeeting(env, parseMeeting(report({ title: "Comité", start: T0 + 86_400_000, people, platformId: "z-9" })));
  const outcome = await processMeeting(env, parseMeeting(report({ title: "comité", start: T0 + 86_400_000 + 240_000, people, platformId: null })));
  assert.equal(outcome, "merged");
  assert.equal((await items()).filter((one) => one.meeting.title.toLowerCase() === "comité").length, 1);
});

// ---- Failures ------------------------------------------------------------------

await scenario("reprise : Notion coupé → erreur visible ; Réessayer → une note, aucun doublon", async () => {
  notionDown = true;
  const payload = report({ title: "Panne", people: [["Théo", "theo@gouman.fr"]], platformId: "p-1" });
  assert.equal(await processMeeting(env, parseMeeting(payload)), "error");
  notionDown = false;
  const item = (await items()).find((one) => one.key === "readai:zoom:p-1");
  assert.equal(item.status, "error");
  assert.equal(item.stage, "process");
  await retry(env, item.id);
  await retry(env, item.id).catch(() => undefined);
  assert.equal(notesFor("readai:zoom:p-1").length, 1);
  assert.equal((await items()).some((one) => one.key === "readai:zoom:p-1"), false);
});

await scenario("reprise : échec à la clôture → décisions gardées, aucun contact recréé", async () => {
  await processMeeting(env, parseMeeting(report({ title: "Clôture", people: [["Olga", "olga@neuve2.fr"]], platformId: "p-2" })));
  const item = (await items()).find((one) => one.key === "readai:zoom:p-2");
  const before = [...pages.values()].filter((page) => page.ds === "ds-contacts").length;
  // The contact is created, then Notion fails on the note.
  const originalWrite = schemas["ds-notes"].Source.select.options;
  schemas["ds-notes"].Source.select.options = [{ name: "Dictée" }];
  await assert.rejects(queue.decide(env, user, item.id, "olga@neuve2.fr", { action: "create", contact: { name: "Olga" } }), /ReadAI/);
  schemas["ds-notes"].Source.select.options = originalWrite;
  const failed = await queue.loadItem(env, item.id);
  assert.equal(failed.status, "error");
  assert.equal(failed.stage, "close");
  assert.ok(failed.people[0].decision.contactId);
  await retry(env, item.id);
  const after = [...pages.values()].filter((page) => page.ds === "ds-contacts").length;
  assert.equal(after - before, 1, "un seul contact");
  assert.equal(notesFor("readai:zoom:p-2").length, 1);
});

await scenario("option ReadAI absente → erreur de configuration, l'option n'est jamais créée", async () => {
  const saved = schemas["ds-notes"].Source.select.options;
  schemas["ds-notes"].Source.select.options = [{ name: "Dictée" }, { name: "Email" }];
  const outcome = await processMeeting(env, parseMeeting(report({ title: "Sans option", people: [["Théo", "theo@gouman.fr"]], platformId: "o-1" })));
  schemas["ds-notes"].Source.select.options = saved;
  assert.equal(outcome, "error");
  const item = (await items()).find((one) => one.key === "readai:zoom:o-1");
  assert.match(item.error, /ReadAI/);
  assert.equal(notesFor("readai:zoom:o-1").length, 0);
});

await scenario("stockage indisponible à la réception → 503 (Read AI réessaiera)", async () => {
  redisDown = true;
  const body = JSON.stringify(report({ people: [["Théo", "theo@gouman.fr"]] }));
  const response = await post(body, sign(body));
  redisDown = false;
  assert.equal(response.status, 503);
});

// ---- Authentication --------------------------------------------------------------

const call = (handler, path, { method = "POST", body, cookie, headers = {} } = {}) =>
  handler({
    request: new Request(`http://x${path}`, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  });

let sentCode = null;
await scenario("auth : sans session → 401 partout, x-user-email seul ne suffit plus", async () => {
  const headers = { "x-user-email": "theo@gouman.fr" };
  assert.equal((await call(contacts.onRequestGet, "/api/contacts", { method: "GET", headers })).status, 401);
  assert.equal((await call(session.onRequestPost, "/api/session", { headers, body: {} })).status, 401);
  assert.equal((await call(screen.onRequestGet, "/api/readai/items", { method: "GET", headers })).status, 401);
});

await scenario("auth : adresse hors liste → même réponse ; code faux 5 fois → bloqué", async () => {
  const outsider = await call(auth, "/api/auth/code", { body: { email: "inconnu@exemple.fr" } });
  // Allowed address: SMTP is not configured here, so the code is read from the store.
  const allowed = await call(auth, "/api/auth/code", { body: { email: "ob@mosaicfin.com" } });
  assert.equal(outsider.status, allowed.status);
  assert.deepEqual(await outsider.json(), await allowed.json());
  // SMTP missing means no code was made; make one through the module.
  const sessionLib = await lib("functions/_lib/session.js");
  store.delete("auth:cool:ob@mosaicfin.com");
  const made = await sessionLib.requestCode(env, "ob@mosaicfin.com", true);
  sentCode = made.code;
  const wrong = String((Number(sentCode) + 1) % 1_000_000).padStart(6, "0");
  for (let i = 0; i < 5; i++) {
    assert.equal((await call(auth, "/api/auth/verify", { body: { email: "ob@mosaicfin.com", code: wrong } })).status, 401);
  }
  const blocked = await call(auth, "/api/auth/verify", { body: { email: "ob@mosaicfin.com", code: sentCode } });
  assert.equal(blocked.status, 401, "le bon code ne passe plus après cinq erreurs");
});

await scenario("auth : renvoi limité à un par minute", async () => {
  const again = await call(auth, "/api/auth/code", { body: { email: "ob@mosaicfin.com" } });
  assert.equal(again.status, 429);
});

await scenario("auth : bon code → cookie HttpOnly ; session ouvre les routes ; déconnexion → révoquée", async () => {
  const sessionLib = await lib("functions/_lib/session.js");
  store.delete("auth:cool:ob@mosaicfin.com");
  const { code } = await sessionLib.requestCode(env, "ob@mosaicfin.com", true);
  const ok = await call(auth, "/api/auth/verify", { body: { email: "ob@mosaicfin.com", code } });
  assert.equal(ok.status, 200);
  const setCookie = ok.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=7776000/);
  const cookie = setCookie.split(";")[0];
  const reused = await call(auth, "/api/auth/verify", { body: { email: "ob@mosaicfin.com", code } });
  assert.equal(reused.status, 401, "usage unique");
  const current = await call(session.onRequestGet, "/api/session", { method: "GET", cookie });
  assert.equal(current.status, 200);
  assert.match(current.headers.get("set-cookie"), /Max-Age=7776000/, "session prolongée");
  assert.equal((await call(screen.onRequestGet, "/api/readai/items", { method: "GET", cookie })).status, 200);
  await call(auth, "/api/auth/logout", { cookie, body: {} });
  assert.equal((await call(session.onRequestGet, "/api/session", { method: "GET", cookie })).status, 401);
});

await scenario("auth : code expiré → refusé", async () => {
  const sessionLib = await lib("functions/_lib/session.js");
  store.delete("auth:cool:pb@mosaicfin.com");
  const { code } = await sessionLib.requestCode(env, "pb@mosaicfin.com", true);
  store.get("auth:code:pb@mosaicfin.com").expires = Date.now() - 1;
  assert.equal((await call(auth, "/api/auth/verify", { body: { email: "pb@mosaicfin.com", code } })).status, 401);
});

// ---- Logs ----------------------------------------------------------------------

console.log(`\nAppels Notion simulés : ${calls}`);
rmSync(out, { recursive: true, force: true });
const failed = results.filter(([status]) => status === "fail").length;
console.log(failed ? `${failed} scénario(s) en échec sur ${results.length}.` : `Les ${results.length} scénarios passent.`);
process.exit(failed ? 1 : 0);
