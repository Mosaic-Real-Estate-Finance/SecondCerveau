import { contactProperty, propertyItems } from "../notes-db.js";
import { dataSourceId, notion, props, readaiSource, schemaOf, type Env, type Schema } from "../notion.js";
import { BATCH, callout, paragraph, richText, type Block, type RichText } from "../thread.js";
import { clock, type Meeting } from "./payload.js";

// The note a meeting becomes (brief §7).
//
// Two callouts in the body, a summary and the transcript, and nothing else —
// which is why the page is created WITHOUT the notes base's default template,
// unlike the dictation's and the mail's (research F-1).

/** A schema that cannot hold the note. Retrying will not help until a human acts. */
export class ConfigError extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// About three requests a second, the rate Notion allows an integration
// (constitution, principle VII). notion() already retries a 429 on its own.
const PACE_MS = 350;

const clientIdColumn = (env: Env) => props(env).noteClientId || "ID client";

export type NoteRef = { id: string; url: string };

/** The note already written for this meeting, if any. Notion is the truth. */
export async function findNoteByKey(env: Env, key: string): Promise<NoteRef | null> {
  const sourceId = await dataSourceId(env, env.NOTION_NOTES_DB);
  const schema = await schemaOf(env, sourceId);
  const column = schema[clientIdColumn(env)];
  if (column?.type !== "rich_text") {
    throw new ConfigError(`La base de notes n'a pas de propriété texte « ${clientIdColumn(env)} »`);
  }
  const result = await notion<{ results: NoteRef[] }>(
    env,
    `/data_sources/${sourceId}/query?filter_properties[]=${encodeURIComponent(column.id)}`,
    { method: "POST", body: { filter: { property: column.name, rich_text: { equals: key } }, page_size: 1 } },
  );
  const page = result.results[0];
  return page ? { id: page.id, url: page.url } : null;
}

/** One paragraph per line of the summary; blank lines collapse. */
export const summaryParagraphs = (summary: string): Block[] => {
  const lines = summary
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return (lines.length ? lines : ["(aucun résumé)"]).map((line) => paragraph(line));
};

/** "**Name** (mm:ss) — words", one paragraph per turn, in order. */
export const transcriptParagraphs = (meeting: Pick<Meeting, "blocks">): Block[] => {
  if (!meeting.blocks.length) return [paragraph("(aucune transcription)")];
  return meeting.blocks.map((block) => {
    // The space travels with the bold name: richText() trims what it cuts.
    const name: RichText = {
      type: "text",
      text: { content: `${block.speaker.slice(0, 200)} ` },
      annotations: { bold: true },
    };
    return paragraph([name, ...richText(`(${clock(block.at)}) — ${block.words}`)]);
  });
};

/**
 * Writes the two callouts.
 *
 * A one hour transcript is several hundred paragraphs, and an append takes at
 * most 100 blocks, nested ones included. So the first request carries both
 * callouts with as many children as fit, and the rest is appended to each
 * callout by its own id, a hundred at a time.
 */
export async function writeBody(env: Env, pageId: string, meeting: Pick<Meeting, "summary" | "blocks">) {
  const summary = summaryParagraphs(meeting.summary);
  const transcript = transcriptParagraphs(meeting);
  const room = BATCH - 2;
  const firstSummary = Math.min(summary.length, Math.floor(room / 2));
  const firstTranscript = Math.min(transcript.length, room - firstSummary);

  const head = await notion<{ results: { id: string }[] }>(env, `/blocks/${pageId}/children`, {
    method: "PATCH",
    body: {
      children: [
        callout("Résumé", summary.slice(0, firstSummary), { divider: false }),
        callout("Transcription", transcript.slice(0, firstTranscript), { divider: false }),
      ],
    },
  });
  const [summaryId, transcriptId] = head.results.map((block) => block.id);
  if (!summaryId || !transcriptId) throw new Error("Notion n'a pas rendu les deux encadrés");

  const rest: [string, Block[]][] = [
    [summaryId, summary.slice(firstSummary)],
    [transcriptId, transcript.slice(firstTranscript)],
  ];
  for (const [parent, blocks] of rest) {
    for (let at = 0; at < blocks.length; at += BATCH) {
      await sleep(PACE_MS);
      await notion(env, `/blocks/${parent}/children`, {
        method: "PATCH",
        body: { children: blocks.slice(at, at + BATCH) },
      });
    }
  }
}

/** The select option, read from the schema: never created in silence. */
function sourceValue(env: Env, schema: Schema) {
  const p = props(env);
  const column = schema[p.noteSource];
  if (!column) return null;
  if (column.type !== "select") throw new ConfigError(`« ${p.noteSource} » n'est pas une sélection`);
  const wanted = readaiSource(env);
  if (!column.select?.options.some((option) => option.name === wanted)) {
    throw new ConfigError(`L'option « ${wanted} » manque dans « ${p.noteSource} » : ajoutez-la dans Notion`);
  }
  return { column: p.noteSource, value: { select: { name: wanted } } };
}

export type NewNote = {
  meeting: Meeting;
  key: string;
  authorIds: string[];
  contactIds: string[];
};

/**
 * Creates the note, or hands back the one already made for this key.
 *
 * The key goes into "ID client" at creation, so a replay never makes a second
 * page (principle V). If the body cannot be written the page goes to the
 * trash before the error rises: a page without its content would be found by
 * the key, and the retry would then never write it (same rule as the mail
 * notes, verified on the real base on 2026-10-03).
 */
export async function createMeetingNote(env: Env, note: NewNote): Promise<NoteRef & { created: boolean }> {
  const existing = await findNoteByKey(env, note.key);
  if (existing) {
    await completeNote(env, existing.id, note.authorIds, note.contactIds);
    return { ...existing, created: false };
  }

  const p = props(env);
  const sourceId = await dataSourceId(env, env.NOTION_NOTES_DB);
  const schema = await schemaOf(env, sourceId);
  const title = Object.values(schema).find((property) => property.type === "title");
  if (!title) throw new ConfigError("La base de notes n'a pas de titre");
  const relation = await contactProperty(env, schema);
  const source = sourceValue(env, schema);

  const properties: Record<string, unknown> = {
    [title.name]: { title: richText(note.meeting.title || "Réunion Read AI") },
    [relation]: { relation: [...new Set(note.contactIds)].map((id) => ({ id })) },
    [clientIdColumn(env)]: { rich_text: [{ type: "text", text: { content: note.key } }] },
  };
  // A Notion date always takes a time; the full instant is written and Notion
  // shows it in each reader's own zone.
  if (schema[p.noteDate]?.type === "date") properties[p.noteDate] = { date: { start: note.meeting.start } };
  if (schema[p.noteAuthor]?.type === "people" && note.authorIds.length) {
    properties[p.noteAuthor] = { people: [...new Set(note.authorIds)].map((id) => ({ object: "user", id })) };
  }
  if (source) properties[source.column] = source.value;
  // "Statut IA" and "Transcription brute" are deliberately left alone: the
  // first triggers nothing and may go, the second belongs to the dictation.

  const page = await notion<NoteRef>(env, "/pages", {
    method: "POST",
    body: { parent: { type: "data_source_id", data_source_id: sourceId }, properties },
  });

  try {
    await writeBody(env, page.id, note.meeting);
  } catch (error) {
    await notion(env, `/pages/${page.id}`, { method: "PATCH", body: { in_trash: true } }).catch(() => undefined);
    throw error;
  }
  return { id: page.id, url: page.url, created: true };
}

/**
 * Adds authors and contacts to a note that exists, by union: whoever is
 * already on it stays. The body is never touched.
 */
export async function completeNote(env: Env, noteId: string, authorIds: string[], contactIds: string[]) {
  const p = props(env);
  const sourceId = await dataSourceId(env, env.NOTION_NOTES_DB);
  const schema = await schemaOf(env, sourceId);
  const properties: Record<string, unknown> = {};

  const relation = await contactProperty(env, schema);
  if (contactIds.length && schema[relation]) {
    const held = (await propertyItems(env, noteId, schema[relation].id))
      .map((item) => item.relation?.id)
      .filter(Boolean) as string[];
    const all = [...new Set([...held, ...contactIds])];
    if (all.length > held.length) properties[relation] = { relation: all.map((id) => ({ id })) };
  }
  const author = schema[p.noteAuthor];
  if (authorIds.length && author?.type === "people") {
    const held = (await propertyItems(env, noteId, author.id)).map((item) => item.people?.id).filter(Boolean) as string[];
    const all = [...new Set([...held, ...authorIds])];
    if (all.length > held.length) properties[p.noteAuthor] = { people: all.map((id) => ({ object: "user", id })) };
  }
  if (Object.keys(properties).length) {
    await notion(env, `/pages/${noteId}`, { method: "PATCH", body: { properties } });
  }
}
