// Who in a thread is a client, and which contact each one is.
//
// Only external addresses are candidates: the notes base is a record of
// exchanges with clients, so an internal thread has nobody to attach and the
// panel refuses to send rather than create an empty note.

export type Participant = {
  address: string;
  name: string;
  internal: boolean;
};

export type MatchedContact = { id: string; name: string; company: string };

const clean = (address: string) => address.trim().toLowerCase();

const domainOf = (address: string) => clean(address).split("@")[1] ?? "";

/**
 * Folds the raw participants of a thread into one entry per address.
 *
 * The same person appears in a thread as often as they wrote or were written
 * to; the first display name wins, because it is the one from the oldest
 * message and Outlook sometimes degrades later ones to the bare address.
 */
export function fold(
  raw: { name: string; address: string }[],
  internalDomains: string[],
  internalAddresses: string[],
): Participant[] {
  const domains = internalDomains.map((domain) => domain.trim().toLowerCase()).filter(Boolean);
  const addresses = new Set(internalAddresses.map(clean));
  const seen = new Map<string, Participant>();
  for (const entry of raw) {
    const address = clean(entry.address);
    if (!address || !address.includes("@")) continue;
    const held = seen.get(address);
    if (held) {
      if (!held.name && entry.name) held.name = entry.name;
      continue;
    }
    seen.set(address, {
      address,
      name: entry.name?.trim() ?? "",
      internal: domains.includes(domainOf(address)) || addresses.has(address),
    });
  }
  return [...seen.values()];
}

export const externals = (participants: Participant[]) => participants.filter((one) => !one.internal);

/**
 * The contact ids to put in the relation.
 *
 * Deduplication is on the Notion page id, never on the address: one contact
 * holding two of the addresses of a thread must be linked once, and comparing
 * addresses cannot see that they are the same person.
 */
export function relationIds(matches: (MatchedContact | null | undefined)[]): string[] {
  const ids = new Set<string>();
  for (const match of matches) if (match?.id) ids.add(match.id);
  return [...ids];
}
