// A mail thread, turned into Notion blocks.
//
// The dictation writes its text into a property; a mail is too long for that
// and reads badly as one paragraph, so it goes into the body of the page:
// one callout per message, with the message under it.
//
// Three limits of the Notion API shape everything here, and none of them can
// be worked around by retrying:
//   - 2000 characters per rich text item (a block may hold several items);
//   - 100 blocks per append request, nested children included;
//   - two levels of nesting per request, which is exactly what
//     callout > (divider, paragraphs) needs.
// https://developers.notion.com/reference/request-limits

export type ThreadMessage = {
  /** The Graph message id. Becomes the "Dernier message" mark once written. */
  id: string;
  receivedAt: string;
  from: { name: string; address: string };
  /** uniqueBody as text: the message without the quotes of the previous ones. */
  text: string;
  attachmentNames: string[];
};

type RichText = { type: "text"; text: { content: string } };
type Block = Record<string, unknown>;

const ITEM = 2000;
/** Blocks per append request. */
export const BATCH = 100;
// A callout plus its divider is two; staying at 90 paragraphs leaves room for
// both and for the attachment line, so a single callout never exceeds BATCH.
const PARAGRAPHS = 90;

const MONTHS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

// A mail carries an instant, not a time: 18:57 UTC is what Graph returns for
// something written at 20:57 in Paris. The note has to read in the hour the
// exchange happened, so the stamp is built in the firm's own time zone —
// fixed, not the reader's, so the same note says the same thing to everyone.
const ZONE = "Europe/Paris";

// Numeric parts only, assembled by hand: an ICU update can change where fr-FR
// puts its comma or which space it uses, and the title of a block is not the
// place to discover that.
const PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE,
  day: "numeric",
  month: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const partsOf = (iso: string) => {
  const date = new Date(iso);
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  return Object.fromEntries(PARTS.formatToParts(safe).map((part) => [part.type, part.value]));
};

/** "3 octobre 2026", in Paris time. Invalid or missing: today. */
export function frenchDate(iso: string): string {
  const { day, month, year } = partsOf(iso);
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

/** "3 octobre 2026 à 20:57", in Paris time. */
export function frenchStamp(iso: string): string {
  const { hour, minute } = partsOf(iso);
  return `${frenchDate(iso)} à ${hour}:${minute}`;
}

/** The display name, never the address — unless the name is all we lack. */
const writerOf = (from: { name: string; address: string }) =>
  from.name.trim() || from.address.trim() || "Expéditeur inconnu";

// Cuts on a sentence end when there is one late enough, on a space otherwise,
// and mid-word only when a single word is longer than the limit. Same rule as
// the dictation's own splitter in functions/api/notes.ts.
export function richText(text: string): RichText[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > ITEM) {
    const window = rest.slice(0, ITEM);
    const cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf(" "));
    const at = cut > ITEM / 2 ? cut + 1 : ITEM;
    parts.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  if (rest) parts.push(rest);
  return parts.map((content) => ({ type: "text", text: { content } }));
}

const paragraph = (text: string): Block => ({
  object: "block",
  type: "paragraph",
  paragraph: { rich_text: richText(text) },
});

// `icon` here is Notion's own icon set, addressed by name — the same names as
// the /icons/<name>_<colour>.svg URLs. Checked against the live API on
// 2026-10-03: posted this way it is stored and returned verbatim, where an
// external URL to the same file is silently rewritten into it.
const ICON = { type: "icon", icon: { name: "conversation", color: "gray" } };

const callout = (title: string, children: Block[]): Block => ({
  object: "block",
  type: "callout",
  callout: {
    rich_text: richText(title),
    icon: ICON,
    color: "gray_background",
    children: [{ object: "block", type: "divider", divider: {} }, ...children],
  },
});

/** A blank line in the mail opens a new paragraph; runs of blanks collapse. */
const paragraphsOf = (text: string) =>
  text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

/**
 * One callout per message, in the order given — the caller sorts, because
 * Graph cannot (see research C-2) and the server must not guess.
 *
 * A message with more paragraphs than fit under one callout is continued in a
 * second callout rather than silently cut: the limit is the API's, the text is
 * the client's.
 */
export function blocksFor(messages: ThreadMessage[]): Block[] {
  const blocks: Block[] = [];
  for (const message of messages) {
    const body = paragraphsOf(message.text);
    if (message.attachmentNames.length) {
      body.push(`Pièces jointes : ${message.attachmentNames.join(", ")}`);
    }
    // An empty message still gets its callout: the thread must show that it
    // happened, and its id counts as handled either way.
    if (!body.length) body.push("(message sans texte)");

    const title = `${writerOf(message.from)} a écrit le ${frenchStamp(message.receivedAt)}`;
    for (let at = 0; at < body.length; at += PARAGRAPHS) {
      const slice = body.slice(at, at + PARAGRAPHS);
      blocks.push(callout(at === 0 ? title : `${title} (suite)`, slice.map(paragraph)));
    }
  }
  return blocks;
}

/** Every block of a tree, so a batch is measured the way Notion counts it. */
function size(block: Block): number {
  const body = block[block.type as string] as { children?: Block[] } | undefined;
  return 1 + (body?.children ?? []).reduce((total, child) => total + size(child), 0);
}

/** Groups of top level blocks, each group small enough for one request. */
export function batches(blocks: Block[], max = BATCH): Block[][] {
  const groups: Block[][] = [];
  let group: Block[] = [];
  let count = 0;
  for (const block of blocks) {
    const weight = size(block);
    if (group.length && count + weight > max) {
      groups.push(group);
      group = [];
      count = 0;
    }
    group.push(block);
    count += weight;
  }
  if (group.length) groups.push(group);
  return groups;
}
