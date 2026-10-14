import { later } from "./background.js";
import { companyNames, titleOf } from "./contact.js";
import { dataSourceId, notion, props, queryAll, schemaOf, type Env } from "./notion.js";
import { redis } from "./redis.js";

// The names the dictation should expect, read from Notion: the contacts, the
// companies they belong to, the people of the workspace, and the names that
// come back in the subjects of the notes — projects, places, counterparties.
// They are what a general transcription model gets wrong — a rare surname
// heard as two common words, a street name heard as another — and they change
// with every new client: read here, they are never written into the code.
//
// Handed to the app with the stream key (/api/auth/stt-token), next to the
// fixed jargon of src/lib/vocabulary.ts, and sent to Soniox as context terms.
//
// A dictation never waits for Notion. The list is kept in Redis: a copy is
// answered at once, and one older than REFRESH_MS is read again behind the
// response. With no copy at all (the very first time, or Redis down), the
// dictation starts with the fixed jargon only and the list is built for the
// next one.

const KEY = "stt:terms";
const REFRESH_MS = 6 * 3600_000;
const KEEP_SECONDS = 30 * 86_400;
// Soniox allows about 8,000 tokens of context; the fixed jargon takes a few
// hundred. The most recent names first, cut here.
const MAX_CHARS = 9_000;
const BUSY_KEY = `${KEY}:refreshing`;

type Stored = { at: number; terms: string[] };

// Words of a note subject that say what kind of meeting it was, not who or
// what it was about.
const GENERIC = new Set(
  `call calls intro rdv rendez-vous update updates point points présentation presentation réunion suivi note notes
  visite procédure commercialisation financement financing acquisition reporting sortie prepare meeting pris prise
  contact accompagnement accompgnement levée com cash proceeds post vente renomme titre cette juridique contentieux
  avocats garanties projet projets nouveaux nouvelles nouvelle cas opérations operations structure services cabinet
  new deal deals dossiers cours rentrée début debut année du de des la le les et en à au aux pour avec sur dont
  intro call broker conseil intermédiation immo eco clubs equity dette fund raising souscription développements
  coverage audit loan dev mezz bridge capex groupe group capital management collection community sa sas
  rue loi rendez envoi cession venture real mer`
    .split(/\s+/)
    .filter(Boolean),
);

/** The proper names of a note subject: runs of capitalised words that are not generic. */
export function subjectNames(subject: string): string[] {
  const names: string[] = [];
  // Separators and anything numeric (dates, amounts, lot numbers) break runs.
  for (const part of subject.split(/[-–—:|/()&,+]|\s[x×]\s|\d[\d.,/€%MK]*/)) {
    let run: string[] = [];
    const flush = () => {
      if (run.length) names.push(run.join(" "));
      run = [];
    };
    for (const word of part.split(/\s+/).filter(Boolean)) {
      const bare = word.replace(/^[«"'’(]+|[»"'’).]+$/g, "");
      const capitalised = /^[A-ZÀ-ÖØ-Þ]/.test(bare);
      if (capitalised && bare.length >= 3 && !GENERIC.has(bare.toLowerCase()) && run.length < 4) run.push(bare);
      else flush();
    }
    flush();
  }
  return names;
}

async function titles(env: Env, sourceId: string, sortByCreated: boolean): Promise<{ id: string; name: string; page: any }[]> {
  const schema = await schemaOf(env, sourceId);
  const title = Object.values(schema).find((property) => property.type === "title");
  const sorts = sortByCreated ? [{ timestamp: "created_time", direction: "descending" }] : undefined;
  const pages = await queryAll(env, sourceId, sorts ? { sorts } : {}, title ? [title.id] : []);
  return pages.map((page) => ({ id: page.id, name: titleOf(page.properties), page }));
}

/** Reads every source and builds the list, most recent names first. */
async function build(env: Env): Promise<string[]> {
  const found: string[] = [];

  // The people of the workspace: the team, by their full names.
  const users = await notion<{ results: { type: string; name?: string }[] }>(env, "/users?page_size=100").catch(() => null);
  for (const user of users?.results ?? []) if (user.type === "person" && user.name) found.push(user.name);

  // The contacts, newest first, and the companies they belong to.
  const contactsId = await dataSourceId(env, env.NOTION_CONTACTS_DB);
  const contacts = await titles(env, contactsId, true);
  found.push(...contacts.map((contact) => contact.name));
  const relation = (await schemaOf(env, contactsId))[props(env).companyRelation];
  const companiesId = relation?.type === "relation" ? relation.relation?.data_source_id : undefined;
  if (companiesId) found.push(...(await companyNames(env, companiesId)).values());

  // What the notes are about: the names in their subjects, newest first.
  const notesId = await dataSourceId(env, env.NOTION_NOTES_DB);
  for (const note of await titles(env, notesId, true)) found.push(...subjectNames(note.name));

  const seen = new Set<string>();
  const terms: string[] = [];
  let length = 0;
  for (const raw of found) {
    const term = raw.replace(/\s+/g, " ").trim();
    const key = term.toLowerCase();
    if (term.length < 2 || term.length > 60 || seen.has(key)) continue;
    if (length + term.length + 2 > MAX_CHARS) break;
    seen.add(key);
    terms.push(term);
    length += term.length + 2;
  }
  return terms;
}

async function refresh(env: Env) {
  // One rebuild at a time across the instances.
  const free = await redis(env).set(BUSY_KEY, "1", { nx: true, ex: 120 });
  if (!free) return;
  try {
    const terms = await build(env);
    await redis(env).set(KEY, { at: Date.now(), terms } satisfies Stored, { ex: KEEP_SECONDS });
  } finally {
    await redis(env).del(BUSY_KEY);
  }
}

/** The names for this dictation, at once; a stale or missing list is rebuilt behind the response. */
export async function dictationTerms(env: Env): Promise<string[]> {
  let stored: Stored | null = null;
  try {
    stored = await redis(env).get<Stored>(KEY);
  } catch {
    return [];
  }
  if (!stored || Date.now() - stored.at > REFRESH_MS) later("vocabulaire", refresh(env));
  return Array.isArray(stored?.terms) ? stored.terms : [];
}
