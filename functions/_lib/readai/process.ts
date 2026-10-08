import { internalDomains } from "../auth.js";
import type { Env } from "../notion.js";
import { notifyAll } from "../push.js";
import { redis } from "../redis.js";
import { findSame, keyOf, RECENT_MS, traceOf, type Trace } from "./meeting-key.js";
import { matchExternals } from "./match.js";
import { completeNote, createMeetingNote, findNoteByKey } from "./note.js";
import type { Meeting } from "./payload.js";
import { split } from "./participants.js";
import {
  close,
  excludedSet,
  KEYS,
  loadItem,
  locked,
  newId,
  saveItem,
  deleteItem,
  QueueError,
  type PendingPerson,
  type QueueItem,
  type Recognized,
} from "./queue.js";

// One report, from its participants to its outcome (brief §4).
//
// Logs name the outcome and technical ids, never a title, a name, an address
// or a word of the meeting (constitution, principle VIII).

export type Outcome = "ignored" | "noted" | "queued" | "merged" | "error";

const valider = (id: string) => `/?valider=${id}`;
const plural = (count: number) => `${count} personne${count > 1 ? "s" : ""} à valider`;
const titleOf = (meeting: Pick<Meeting, "title">) => meeting.title || "Réunion sans titre";

/** What a waiting call keeps: the meeting minus its raw participant list. */
const stored = (meeting: Meeting) => {
  const { participants: _participants, ...rest } = meeting;
  return rest;
};

/** A report that could not be processed is kept whole, to be replayed. */
async function keepFailed(env: Env, meeting: Meeting, error: unknown): Promise<QueueItem | null> {
  const item: QueueItem = {
    id: newId(),
    key: keyOf(meeting),
    kind: "new",
    status: "error",
    stage: "process",
    error: (error as Error)?.message?.slice(0, 300) || "Erreur inattendue",
    createdAt: new Date().toISOString(),
    meeting,
    authors: [],
    recognized: [],
    people: [],
  };
  try {
    await saveItem(env, item);
    return item;
  } catch {
    return null;
  }
}

async function recentTraces(env: Env): Promise<Record<string, Trace>> {
  const all = (await redis(env).hgetall<Record<string, Trace>>(KEYS.recent)) ?? {};
  const stale = Object.entries(all)
    .filter(([, trace]) => Date.now() - trace.at > RECENT_MS)
    .map(([key]) => key);
  if (stale.length) await redis(env).hdel(KEYS.recent, ...stale);
  return all;
}

/**
 * Processes one meeting_end. Never throws: whatever fails after the webhook
 * has answered becomes an item in error, visible and retryable (principle VI).
 */
export async function processMeeting(env: Env, meeting: Meeting): Promise<Outcome> {
  try {
    const outcome = await run(env, meeting);
    console.info(`[readai] ${outcome} session=${meeting.sessionId.slice(0, 12)}`);
    return outcome;
  } catch (error) {
    console.error(`[readai] error session=${meeting.sessionId.slice(0, 12)} cause=${(error as Error)?.name}`);
    const item = await keepFailed(env, meeting, error);
    await notifyAll(env, {
      title: `Réunion non enregistrée — ${titleOf(meeting)}`,
      body: "Ouvrez « À valider » pour réessayer.",
      url: item ? valider(item.id) : "/",
      tag: item?.id,
    });
    return "error";
  }
}

async function run(env: Env, meeting: Meeting): Promise<Outcome> {
  const excluded = await excludedSet(env);
  const { authors, externals } = split(meeting, internalDomains(env), excluded);
  // Only colleagues, or externals without an address, or all excluded:
  // nothing for the CRM, and nobody is told.
  if (!externals.length) return "ignored";

  const matches = await matchExternals(
    env,
    externals.map((person) => person.email),
  );
  const recognized: Recognized[] = [];
  const people: PendingPerson[] = [];
  for (const person of externals) {
    const result = matches[person.email];
    if (result?.status === "recognized") {
      recognized.push({ email: person.email, ...result.contact });
      continue;
    }
    people.push({
      email: person.email,
      name: person.name || person.email,
      firstName: person.firstName,
      lastName: person.lastName,
      companies: result?.status === "unknown" ? result.companies : [],
      candidates: result?.status === "ambiguous" ? result.candidates : [],
    });
  }

  return locked(env, 240_000, async () => {
    const trace = traceOf(
      meeting.title,
      meeting.start,
      externals.map((person) => person.email),
    );
    // Where this meeting stands: an item waiting under its key, or a note in
    // Notion carrying the key. A pointer whose item is gone counts as none.
    const standing = async (key: string) => {
      const pointer = await redis(env).get<string>(KEYS.meeting(key));
      const waiting = pointer ? await loadItem(env, pointer) : null;
      return { waiting, note: waiting ? null : await findNoteByKey(env, key) };
    };
    let key = keyOf(meeting);
    let { waiting, note } = await standing(key);
    if (!waiting && !note) {
      // Not known under its own key: perhaps the same meeting, recorded by
      // someone else through another path (research C-2).
      const recent = await recentTraces(env);
      delete recent[key];
      const same = findSame(trace, recent);
      if (same) {
        key = same;
        ({ waiting, note } = await standing(key));
      }
    }
    await redis(env).hset(KEYS.recent, { [key]: trace });

    const authorIds = authors.map((author) => author.notionUserId);

    // ---- Already waiting: one item, enriched. ----
    if (waiting) {
      const added = merge(waiting, authors, recognized, people);
      if (waiting.kind === "complete" && waiting.noteId) {
        // The note exists: authors and recognised contacts join it now.
        await completeNote(env, waiting.noteId, authorIds, recognized.map((contact) => contact.id));
      }
      await saveItem(env, waiting);
      if (added) await notifyQueued(env, waiting);
      return "merged";
    }

    // ---- Already noted: complete it, never rewrite it. ----
    if (note) {
      await completeNote(env, note.id, authorIds, recognized.map((contact) => contact.id));
      if (people.length) {
        const item = await queue(env, { meeting, key, kind: "complete", authors, recognized, people, note });
        await notifyQueued(env, item);
      }
      return "merged";
    }

    // ---- New meeting. ----
    if (!people.length) {
      const created = await createMeetingNote(env, { meeting, key, authorIds, contactIds: recognized.map((c) => c.id) });
      await notifyAll(env, {
        title: `Réunion ajoutée — ${titleOf(meeting)}`,
        body: recognized.map((contact) => contact.name).filter(Boolean).join(", "),
        url: created.url,
        tag: key,
      });
      return "noted";
    }
    const item = await queue(env, { meeting, key, kind: "new", authors, recognized, people, note: null });
    await notifyQueued(env, item);
    return "queued";
  });
}

function merge(
  item: QueueItem,
  authors: QueueItem["authors"],
  recognized: Recognized[],
  people: PendingPerson[],
): boolean {
  for (const author of authors) {
    if (!item.authors.some((held) => held.notionUserId === author.notionUserId)) item.authors.push(author);
  }
  const known = new Set([...item.recognized.map((contact) => contact.email), ...item.people.map((person) => person.email)]);
  for (const contact of recognized) {
    if (!known.has(contact.email)) item.recognized.push(contact);
  }
  let added = false;
  for (const person of people) {
    if (known.has(person.email)) continue;
    item.people.push(person);
    added = true;
  }
  return added;
}

async function queue(
  env: Env,
  input: {
    meeting: Meeting;
    key: string;
    kind: QueueItem["kind"];
    authors: QueueItem["authors"];
    recognized: Recognized[];
    people: PendingPerson[];
    note: { id: string; url: string } | null;
  },
): Promise<QueueItem> {
  const base = stored(input.meeting);
  const item: QueueItem = {
    id: newId(),
    key: input.key,
    kind: input.kind,
    status: "pending",
    createdAt: new Date().toISOString(),
    // Completing a note needs no content: the note already has it.
    meeting: input.kind === "complete" ? { ...base, summary: "", blocks: [] } : base,
    authors: input.authors,
    recognized: input.kind === "complete" ? [] : input.recognized,
    people: input.people,
    ...(input.note ? { noteId: input.note.id, noteUrl: input.note.url } : {}),
  };
  await saveItem(env, item);
  await redis(env).set(KEYS.meeting(input.key), item.id);
  return item;
}

async function notifyQueued(env: Env, item: QueueItem) {
  const open = item.people.filter((person) => !person.decision).length;
  await notifyAll(env, {
    title: `${plural(open)} — ${titleOf(item.meeting)}`,
    body: item.kind === "complete" ? "À ajouter à une note existante." : "Rien n'est écrit dans Notion avant votre décision.",
    url: valider(item.id),
    tag: item.id,
  });
}

/**
 * "Réessayer" on an item in error. A processing failure replays the whole
 * report; a failed note keeps every decision and only writes again.
 */
export async function retry(env: Env, itemId: string) {
  const item = await locked(env, 30_000, () => loadItem(env, itemId));
  if (!item) throw new QueueError(404, "Cet appel a déjà été traité.", "gone");
  if (item.stage === "process") {
    await locked(env, 30_000, () => deleteItem(env, item));
    const outcome = await processMeeting(env, item.meeting as Meeting);
    return { outcome };
  }
  return locked(env, 30_000, async () => {
    const fresh = await loadItem(env, itemId);
    if (!fresh) throw new QueueError(404, "Cet appel a déjà été traité.", "gone");
    return close(env, fresh);
  });
}
