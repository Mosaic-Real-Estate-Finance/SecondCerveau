import { findUser } from "../users.js";
import type { Meeting, Person } from "./payload.js";

// Who is in the meeting, as far as the CRM is concerned (brief §5.1 – §5.3).
//
// Three groups. Without an address, a participant is dropped: matching on a
// name is too much of a guess. An address on an internal domain is a Mosaic
// colleague — never a contact, and an author when they use the app. Everyone
// else is external, and the only candidates for the contacts of the note.

export type Split = {
  /** Notion user ids of the colleagues present who use the app. */
  authors: { email: string; notionUserId: string }[];
  /** External, not excluded: the ones to recognise. */
  externals: (Person & { email: string })[];
  /** How many were dropped and why, for a log line that names nobody. */
  counts: { noEmail: number; internal: number; excluded: number };
};

export const domainOf = (email: string) => email.slice(email.lastIndexOf("@") + 1);

/** Owner added when missing, emails lowercased, one entry per address. */
export function everyone(meeting: Pick<Meeting, "participants" | "owner">): Person[] {
  const people = [...meeting.participants];
  if (meeting.owner) people.push(meeting.owner);
  const seen = new Set<string>();
  const out: Person[] = [];
  for (const person of people) {
    const email = person.email?.trim().toLowerCase() || null;
    if (email) {
      if (seen.has(email)) continue;
      seen.add(email);
    }
    out.push({ ...person, email });
  }
  return out;
}

export function split(
  meeting: Pick<Meeting, "participants" | "owner">,
  internalDomains: string[],
  excluded: Set<string>,
): Split {
  const authors: Split["authors"] = [];
  const externals: Split["externals"] = [];
  const counts = { noEmail: 0, internal: 0, excluded: 0 };
  for (const person of everyone(meeting)) {
    const email = person.email;
    if (!email) {
      counts.noEmail++;
      continue;
    }
    if (internalDomains.includes(domainOf(email))) {
      counts.internal++;
      const user = findUser(email);
      if (user && !authors.some((author) => author.notionUserId === user.notionUserId)) {
        authors.push({ email: user.email, notionUserId: user.notionUserId });
      }
      continue;
    }
    if (excluded.has(email)) {
      counts.excluded++;
      continue;
    }
    externals.push({ ...person, email });
  }
  return { authors, externals, counts };
}
