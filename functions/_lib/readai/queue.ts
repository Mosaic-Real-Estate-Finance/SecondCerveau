import { randomBytes } from "node:crypto";
import { createContact, titleOf, type NewContact } from "../contact.js";
import { notion, props, type Env } from "../notion.js";
import { acquire, redis, release } from "../redis.js";
import type { User } from "../users.js";
import type { CompanyRef, ContactRef } from "./match.js";
import { addressesOf } from "./match.js";
import { completeNote, createMeetingNote } from "./note.js";
import type { Meeting } from "./payload.js";

// The calls waiting for a decision (brief §8).
//
// Nothing about them is in Notion until every person is settled: that is the
// whole point of passing through the app. So the call lives here, whole —
// summary and transcript included — and only here, and it is deleted as soon
// as its note exists or it is set aside (constitution 2.0.0, principle II).

export const KEYS = {
  item: (id: string) => `readai:item:${id}`,
  items: "readai:items",
  meeting: (key: string) => `readai:meeting:${key}`,
  excluded: "readai:excluded",
  recent: "readai:recent",
  request: (id: string) => `readai:req:${id}`,
  // One lock for everything that changes the queue or writes a meeting note.
  // A lock per meeting key is not enough: the fallback of research C-2 can
  // join two keys, and two reports each holding its own while waiting for
  // the other's is a deadlock. The traffic is a few meetings a day.
  lock: "readai:lock",
};

export const LOCK_TTL = 280;

export type Author = { email: string; notionUserId: string };
export type Recognized = { email: string } & ContactRef;

export type Decision =
  | { action: "attach" | "create"; contactId: string; name: string; by: string; at: string }
  | { action: "exclude"; by: string; at: string };

export type PendingPerson = {
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  /** Suggested by the domain. Empty for a mail provider or a new domain. */
  companies: CompanyRef[];
  /** The same address on several contacts: the base has a flaw to settle. */
  candidates: ContactRef[];
  decision?: Decision;
};

/** The meeting as kept here: who was there is already sorted into the fields below. */
export type StoredMeeting = Omit<Meeting, "participants"> & { participants?: Meeting["participants"] };

export type QueueItem = {
  id: string;
  key: string;
  kind: "new" | "complete";
  status: "pending" | "error";
  /** Where it failed: the processing of the report, or the writing of the note. */
  stage?: "process" | "close";
  error?: string;
  createdAt: string;
  noteId?: string;
  noteUrl?: string;
  meeting: StoredMeeting;
  authors: Author[];
  recognized: Recognized[];
  people: PendingPerson[];
};

/** What the screen receives: never the transcript, never the raw participants. */
export type ItemView = Omit<QueueItem, "meeting"> & {
  meeting: Omit<StoredMeeting, "blocks" | "participants"> & { turns: number };
};

export class QueueError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export const newId = () => randomBytes(8).toString("hex");

const scoreOf = (item: QueueItem) => Date.parse(item.meeting.start) || Date.now();

export async function loadItem(env: Env, id: string): Promise<QueueItem | null> {
  return (await redis(env).get<QueueItem>(KEYS.item(id))) ?? null;
}

export async function saveItem(env: Env, item: QueueItem) {
  await redis(env)
    .multi()
    .set(KEYS.item(item.id), item)
    .zadd(KEYS.items, { score: scoreOf(item), member: item.id })
    .exec();
}

/** Gone from the store, content and all, and from the pointer of its meeting. */
export async function deleteItem(env: Env, item: QueueItem) {
  const pointer = await redis(env).get<string>(KEYS.meeting(item.key));
  const tx = redis(env).multi().del(KEYS.item(item.id)).zrem(KEYS.items, item.id);
  if (pointer === item.id) tx.del(KEYS.meeting(item.key));
  await tx.exec();
}

export const viewOf = (item: QueueItem): ItemView => {
  const { blocks, participants: _participants, ...meeting } = item.meeting;
  return { ...item, meeting: { ...meeting, turns: blocks.length } };
};

export async function listItems(env: Env): Promise<ItemView[]> {
  const ids = await redis(env).zrange<string[]>(KEYS.items, 0, -1, { rev: true });
  if (!ids.length) return [];
  const items = await redis(env).mget<(QueueItem | null)[]>(...ids.map(KEYS.item));
  return items.filter((item): item is QueueItem => item !== null).map(viewOf);
}

export const countItems = (env: Env) => redis(env).zcard(KEYS.items);

export async function excludedSet(env: Env): Promise<Set<string>> {
  const members = await redis(env).smembers(KEYS.excluded);
  return new Set(members.map((email) => String(email).toLowerCase()));
}

export async function excludedList(env: Env): Promise<string[]> {
  return [...(await excludedSet(env))].sort();
}

export async function removeExcluded(env: Env, email: string) {
  await redis(env).srem(KEYS.excluded, email.trim().toLowerCase());
}

/** Runs `work` holding the queue lock, or refuses with a 409 after `waitMs`. */
export async function locked<T>(env: Env, waitMs: number, work: () => Promise<T>): Promise<T> {
  const held = await acquire(env, KEYS.lock, LOCK_TTL, waitMs);
  if (!held) throw new QueueError(409, "Un autre traitement est en cours, réessayez dans un instant.", "busy");
  try {
    return await work();
  } finally {
    await release(env, KEYS.lock, held);
  }
}

// ---- Contacts --------------------------------------------------------------

/**
 * Adds the address to a contact's Email column, after a comma, unless it is
 * already there. The next meeting with this address is then recognised alone.
 * The column holds a comma separated string whatever its type (research A-1).
 */
export async function appendEmail(env: Env, contactId: string, email: string): Promise<string> {
  const column = props(env).contactEmail;
  const page = await notion<{ properties: Record<string, any> }>(env, `/pages/${contactId}`);
  const property = page.properties[column];
  if (!property) throw new QueueError(500, `La base Contacts n'a pas de propriété « ${column} »`);
  const raw =
    property.type === "email"
      ? (property.email ?? "")
      : (property.rich_text ?? []).map((part: { plain_text?: string }) => part.plain_text ?? "").join("");
  const held = addressesOf(String(raw));
  if (!held.includes(email)) {
    const value = [...held, email].join(", ");
    await notion(env, `/pages/${contactId}`, {
      method: "PATCH",
      body: {
        properties: {
          [column]:
            property.type === "email" ? { email: value } : { rich_text: [{ type: "text", text: { content: value } }] },
        },
      },
    });
  }
  return titleOf(page.properties);
}

// ---- Decisions -------------------------------------------------------------

export type DecideInput =
  | { action: "attach"; contactId: string }
  | { action: "create"; contact: NewContact }
  | { action: "exclude" };

export type Closed = { closed: true; noteUrl: string | null };

const settled = (item: QueueItem) => item.people.every((person) => person.decision);

/**
 * One decision on one person, under the queue lock — so two colleagues
 * settling the same person at the same moment produce one decision and at
 * most one contact. The second is told "Déjà traité".
 */
export async function decide(
  env: Env,
  user: User,
  itemId: string,
  email: string,
  input: DecideInput,
): Promise<{ item: ItemView } | Closed> {
  return locked(env, 30_000, async () => {
    const item = await loadItem(env, itemId);
    if (!item) throw new QueueError(404, "Cet appel a déjà été traité.", "gone");
    const person = item.people.find((one) => one.email === email.trim().toLowerCase());
    if (!person) throw new QueueError(404, "Personne introuvable dans cet appel.", "gone");
    if (person.decision) throw new QueueError(409, "Déjà traité", "decided");

    const at = new Date().toISOString();
    if (input.action === "attach") {
      if (!input.contactId) throw new QueueError(400, "Contact manquant");
      const name = await appendEmail(env, input.contactId, person.email);
      person.decision = { action: "attach", contactId: input.contactId, name, by: user.email, at };
    } else if (input.action === "create") {
      // The address is the person's, never whatever the form carried.
      const contact = await createContact(env, { ...input.contact, email: person.email });
      person.decision = { action: "create", contactId: contact.id, name: contact.name, by: user.email, at };
    } else {
      await redis(env).sadd(KEYS.excluded, person.email);
      person.decision = { action: "exclude", by: user.email, at };
    }
    await saveItem(env, item);

    if (!settled(item)) return { item: viewOf(item) };
    return close(env, item);
  });
}

/**
 * Every person is settled: write the note, then forget the call.
 *
 * Must run under the queue lock. If Notion fails, the item stays, marked as
 * an error with every decision kept — a retry reuses the contacts already
 * created rather than making them again.
 */
export async function close(env: Env, item: QueueItem): Promise<Closed> {
  const chosen = item.people
    .map((person) => (person.decision && "contactId" in person.decision ? person.decision.contactId : null))
    .filter((id): id is string => id !== null);
  const contactIds = [...new Set([...item.recognized.map((contact) => contact.id), ...chosen])];
  const authorIds = item.authors.map((author) => author.notionUserId);

  try {
    let noteUrl: string | null = null;
    if (item.kind === "complete" && item.noteId) {
      if (contactIds.length) await completeNote(env, item.noteId, authorIds, contactIds);
      noteUrl = item.noteUrl ?? null;
    } else if (contactIds.length) {
      const note = await createMeetingNote(env, {
        meeting: item.meeting as Meeting,
        key: item.key,
        authorIds,
        contactIds,
      });
      noteUrl = note.url;
    }
    await deleteItem(env, item);
    return { closed: true, noteUrl };
  } catch (error) {
    item.status = "error";
    item.stage = "close";
    item.error = (error as Error).message?.slice(0, 300) || "Erreur inattendue";
    await saveItem(env, item);
    throw error;
  }
}

/** Set aside: nothing in Notion, and nobody added to the exclusion list. */
export async function ignore(env: Env, itemId: string): Promise<Closed> {
  return locked(env, 30_000, async () => {
    const item = await loadItem(env, itemId);
    if (item) await deleteItem(env, item);
    return { closed: true, noteUrl: null };
  });
}
