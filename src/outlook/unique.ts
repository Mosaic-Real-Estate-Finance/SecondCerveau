// Only the mails that are actually mails.
//
// A conversation read from Graph is not a list of exchanges: it is a list of
// *copies*. Three things in it are not a new message, and all three were
// landing in Notion as a callout of their own.
//
//  1. The same mail, twice. Graph's /me/messages spans every folder of the
//     mailbox, so a reply the user sent comes back both as the copy in Sent
//     Items and as the copy delivered to them, with two different Graph ids.
//     The one thing the two copies share is their RFC 5322 Message-ID, which
//     Graph exposes as `internetMessageId` — that is the identity of a mail,
//     and `id` is only the identity of a copy.
//
//  2. A quote wearing a message's clothes. `uniqueBody` is meant to give the
//     new part of a reply without the history, and usually does. Outlook for
//     Mac composes a reply whose new part sits *above* the quoted header, and
//     on that shape the heuristic sometimes returns the part it should have
//     dropped: a sign-off, a "De: / Date: / À: / Objet:" block, and the
//     previous message repeated underneath.
//
//  3. The sign-off itself. "Envoyé à partir d'Outlook pour Mac" is not
//     something anybody wrote.
//
// So the text is cut at the first quote marker, sign-offs are removed, and a
// message whose text had content before that and none after is dropped: there
// was nothing in it but someone else's words.
//
// A mail that was empty to begin with is kept, because it really was sent —
// that distinction is the whole reason the stripping reports back rather than
// just returning a string.

export type Strippable = {
  id: string;
  from: { name: string; address: string };
  text: string;
  attachmentNames: string[];
  /** Graph ids of the other copies folded onto this one. See `unique`. */
  copyIds?: string[];
  /** The RFC 5322 Message-ID. Two copies of one mail share it. */
  internetMessageId?: string;
};

// ---- Markers ---------------------------------------------------------------

/** "De : ", "À : ", "Objet : "… the lines of a quoted header, FR and EN. */
const HEADER_LINE =
  /^(?:de|from|exp[ée]diteur|envoy[ée]|sent|date|[àa]|to|cc|copie|bcc|cci|objet|subject|r[ée]pondre\s+[àa]|reply-to)\s*:\s/i;

/** The subset that only ever appears in a header, never in a sentence. */
const HEADER_OPENER = /^(?:de|from|exp[ée]diteur)\s*:\s/i;

/** Outlook's own separator, and the rule of underscores it draws above it. */
const SEPARATOR = /^(?:-{2,}\s*(?:original message|message d'origine|forwarded message|message transf[ée]r[ée])\s*-{2,}|_{10,}|-{10,})$/i;

/** "Le 3 octobre 2026 à 20:57, Théo Gouman <x@y> a écrit :" and its variants. */
const ATTRIBUTION = [
  /^(?:le|on)\b.{0,300}\b(?:a\s+[ée]crit|wrote)\s*:\s*$/i,
  /^.{0,200}<[^>]+@[^>]+>\s*(?:a\s+[ée]crit|wrote)\s*:\s*$/i,
];

/** What a phone or a desktop client appends on its own. */
const SIGNOFF =
  /^(?:envoy[ée]e?\s+(?:[àa]\s+partir\s+d|de|depuis|par)\b.{0,80}|sent\s+from\b.{0,80}|(?:get|t[ée]l[ée]charger|obtenir)\s+outlook\b.{0,80})$/i;

// A header block is three of those lines in a row, one of which opens it.
// Three, because a single "Objet : réunion de lundi" is something a person
// writes; three in a row with a "De :" among them is something a mail client
// writes.
const HEADER_RUN = 3;

function headerStartsAt(lines: string[], from: number): boolean {
  let run = 0;
  let opened = false;
  for (let at = from; at < lines.length; at += 1) {
    const line = lines[at];
    if (!line) {
      // One blank line inside the block is normal; two end it.
      if (run && !lines[at + 1]?.trim()) break;
      continue;
    }
    if (!HEADER_LINE.test(line)) break;
    if (HEADER_OPENER.test(line)) opened = true;
    run += 1;
    if (run >= HEADER_RUN && opened) return true;
  }
  return false;
}

const isQuoted = (line: string) => line.startsWith(">");

// ---- Stripping -------------------------------------------------------------

export type Stripped = {
  text: string;
  /** There was text, and none of it was the sender's own. */
  quoteOnly: boolean;
};

/**
 * The sender's own words, and nothing else.
 *
 * Everything from the first quote marker on is cut, then sign-offs and
 * `>` quoting are removed from what is left.
 */
export function strip(raw: string): Stripped {
  const lines = raw.replace(/\r\n/g, "\n").split("\n").map((line) => line.trim());

  let end = lines.length;
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at];
    if (!line) continue;
    if (SEPARATOR.test(line) || ATTRIBUTION.some((rule) => rule.test(line)) || headerStartsAt(lines, at)) {
      end = at;
      break;
    }
  }

  const text = lines
    .slice(0, end)
    .filter((line) => !SIGNOFF.test(line) && !isQuoted(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, quoteOnly: Boolean(raw.trim()) && !text };
}

// ---- Deduplication ---------------------------------------------------------

const normalise = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

// Identical text from the same person is the net under `internetMessageId`,
// for the day a copy comes back without one. It only applies above this
// length, because "Ok" twice in a thread is two mails, not one sent twice.
const SAME_TEXT = 40;

/**
 * One entry per mail, oldest first, with the quotes removed.
 *
 * Expects the list already sorted, because "the first copy" has to mean
 * something. Two copies of one mail are folded onto the Graph id of the first,
 * keeping whichever text survived stripping best — the two copies do not
 * always carry the same `uniqueBody`.
 *
 * A message left with no text and no attachment after stripping is dropped,
 * unless it arrived empty: an empty mail is a fact, a quote is not.
 *
 * The ids of the copies that disappear are kept in `copyIds`, and they are not
 * bookkeeping. "Dernier message" on an existing note may hold the id of a copy
 * that this function now folds away; without the aliases the server would fail
 * to find the mark and append the whole thread a second time.
 */
export function unique<T extends Strippable>(messages: T[]): T[] {
  const kept: T[] = [];
  const byMail = new Map<string, number>();
  const byContent = new Map<string, number>();

  // A message dropped as pure quote is still a copy of something, and its id
  // may be the mark on an existing note. Which mail it belonged to is known
  // only by Message-ID, so that is the only case worth recording.
  const orphans = new Map<string, string[]>();
  const alias = (position: number, id: string) => {
    kept[position] = { ...kept[position], copyIds: [...(kept[position].copyIds ?? []), id] };
  };

  for (const message of messages) {
    const { text, quoteOnly } = strip(message.text);
    const mailId = message.internetMessageId?.trim().toLowerCase() || null;

    if (quoteOnly && !message.attachmentNames.length) {
      if (mailId) orphans.set(mailId, [...(orphans.get(mailId) ?? []), message.id]);
      continue;
    }

    const contentKey =
      text.length >= SAME_TEXT ? `${message.from.address.trim().toLowerCase()}\n${normalise(text)}` : null;

    const at = (mailId ? byMail.get(mailId) : undefined) ?? (contentKey ? byContent.get(contentKey) : undefined);
    if (at !== undefined) {
      // Same mail, second copy. Keep the richer of the two bodies in place.
      if (text.length > kept[at].text.length) kept[at] = { ...kept[at], text };
      if (message.attachmentNames.length > kept[at].attachmentNames.length) {
        kept[at] = { ...kept[at], attachmentNames: message.attachmentNames };
      }
      alias(at, message.id);
      continue;
    }

    kept.push({ ...message, text } as T);
    const position = kept.length - 1;
    if (mailId) byMail.set(mailId, position);
    if (contentKey) byContent.set(contentKey, position);
  }

  // The quote-only copies, now that their mail is known to have been kept.
  for (const [mailId, ids] of orphans) {
    const at = byMail.get(mailId);
    if (at === undefined) continue;
    for (const id of ids) alias(at, id);
  }

  // Everything looked like a quote. That cannot be right, and an empty panel
  // explains nothing: hand back what Graph gave rather than invent silence.
  return kept.length ? kept : messages;
}
