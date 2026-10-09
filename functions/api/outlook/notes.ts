import { contactProperty, propertyItems } from "../../_lib/notes-db.js";
import { batches, blocksFor, type ThreadMessage } from "../../_lib/thread.js";
import {
  dataSourceId,
  fail,
  guard,
  json,
  notion,
  NotionError,
  props,
  schemaOf,
  SOURCE,
  type Env,
  type Handler,
  type Schema,
  type User,
} from "../../_lib/notion.js";

// One note per mail conversation: find it, create it, or add what is new.
//
// The text does not go into a property here. A thread is too long for one and
// reads badly as a block of prose, so it goes into the body of the page, one
// callout per message. "Transcription brute" stays the dictation's.

type Body = {
  conversationId?: string;
  contactIds?: string[];
  messages?: ThreadMessage[];
  // PATCH only.
  noteId?: string;
  sinceMessageId?: string | null;
  /** Feature 003: file uploads already sent to Notion by /api/outlook/attachments. */
  files?: { id: string; name: string }[];
};

type Skipped = { name: string; reason: string };

const text = (content: string) => ({ rich_text: [{ type: "text", text: { content } }] });

const plainOf = (property: any) =>
  (property?.rich_text ?? []).map((part: { plain_text?: string }) => part.plain_text ?? "").join("");

type Found = { id: string; url: string; lastMessageId: string | null };

async function findByConversation(env: Env, sourceId: string, schema: Schema, conversationId: string) {
  const p = props(env);
  const column = schema[p.noteClientId];
  if (!column) return { missing: p.noteClientId } as const;
  const wanted = [column.id, schema[p.noteLastMessage]?.id]
    .filter(Boolean)
    .map((id) => `filter_properties[]=${encodeURIComponent(id as string)}`)
    .join("&");
  const result = await notion<{ results: { id: string; url: string; properties: Record<string, any> }[] }>(
    env,
    `/data_sources/${sourceId}/query?${wanted}`,
    {
      method: "POST",
      body: { filter: { property: p.noteClientId, rich_text: { equals: conversationId } }, page_size: 1 },
    },
  );
  const page = result.results[0];
  if (!page) return { note: null } as const;
  const mark = plainOf(page.properties[p.noteLastMessage]);
  return { note: { id: page.id, url: page.url, lastMessageId: mark || null } satisfies Found } as const;
}

// The default template carries the layout of a note. Notion applies it after
// the page is created — which is also why `children` cannot be passed at
// creation — so the mail's blocks have to wait, or they land above the
// template's own content.
//
// The budget is deliberately short and the outcome is reported rather than
// enforced: an empty default template would never produce a child, and losing
// the order of a few blocks is a cosmetic problem. Losing the mail is not.
const TEMPLATE_TRIES = 5;
const TEMPLATE_WAIT = 400;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForTemplate(env: Env, pageId: string): Promise<boolean> {
  for (let attempt = 0; attempt < TEMPLATE_TRIES; attempt += 1) {
    await sleep(TEMPLATE_WAIT);
    const children = await notion<{ results: unknown[] }>(env, `/blocks/${pageId}/children?page_size=1`).catch(
      () => null,
    );
    if (children?.results.length) return true;
  }
  return false;
}

async function appendThread(env: Env, pageId: string, messages: ThreadMessage[]) {
  for (const group of batches(blocksFor(messages))) {
    await notion(env, `/blocks/${pageId}/children`, { method: "PATCH", body: { children: group } });
  }
}

const lastOf = (messages: ThreadMessage[]) => messages[messages.length - 1];

// ---- Attachments (feature 003) ---------------------------------------------
// The files of the mail go in the Fichiers column, and always in the same
// write as the rest of the properties: on a new page, at creation; on an
// enrichment, in the PATCH that moves the "Dernier message" mark. Either the
// mark and the files land together or neither does, and that is what makes a
// duplicate impossible — once the mark has moved, those messages are never
// "new" again, and neither are their files.
// See specs/003-outlook-mobile-pieces-jointes/research.md C-1.

/** Notion takes at most 100 elements in any array of a request. */
const FILES_MAX = 100;

const fileEntry = (file: { id: string; name: string }) => ({
  type: "file_upload",
  // Kept short: a file object's name is a label in a cell, and a mail
  // attachment can carry a name far longer than any cell shows.
  name: [...file.name.trim()].slice(0, 100).join("") || "fichier",
  file_upload: { id: file.id },
});

/** What Notion returns for a file already in the column, in the shape it takes back. */
function heldEntry(file: any): Record<string, unknown> | null {
  if (file?.type === "file" && file.file?.url) return { name: file.name, type: "file", file: { url: file.file.url } };
  if (file?.type === "external" && file.external?.url) {
    return { name: file.name, type: "external", external: { url: file.external.url } };
  }
  return null;
}

function splitFiles(
  schema: Schema,
  column: string,
  files: { id: string; name: string }[],
  held: number,
): { accepted: { id: string; name: string }[]; skipped: Skipped[] } {
  const valid = files.filter((file) => file?.id?.trim());
  if (!valid.length) return { accepted: [], skipped: [] };
  if (schema[column]?.type !== "files") {
    const reason = `La base de notes n'a pas de colonne fichiers « ${column} ».`;
    return { accepted: [], skipped: valid.map((file) => ({ name: file.name, reason })) };
  }
  const room = Math.max(0, FILES_MAX - held);
  return {
    accepted: valid.slice(0, room),
    skipped: valid.slice(room).map((file) => ({ name: file.name, reason: "Limite de 100 fichiers par note atteinte." })),
  };
}

function noteProperties(
  schema: Schema,
  p: ReturnType<typeof props>,
  user: User,
  messages: ThreadMessage[],
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  if (schema[p.noteDate]?.type === "date") {
    properties[p.noteDate] = { date: { start: lastOf(messages).receivedAt.slice(0, 10) } };
  }
  if (schema[p.noteAuthor]?.type === "people") {
    properties[p.noteAuthor] = { people: [{ object: "user", id: user.notionUserId }] };
  }
  if (schema[p.noteSource]?.type === "select") {
    properties[p.noteSource] = { select: { name: SOURCE.email } };
  }
  if (schema[p.noteAiStatus]?.type === "select") {
    properties[p.noteAiStatus] = { select: { name: "À traiter" } };
  }
  if (schema[p.noteLastMessage]?.type === "rich_text") {
    properties[p.noteLastMessage] = text(lastOf(messages).id);
  }
  return properties;
}

function validate(body: Body) {
  if (!body.conversationId?.trim()) return "Identifiant de conversation manquant";
  if (!body.contactIds?.length) return "Aucun interlocuteur à rattacher";
  if (!body.messages?.length) return "Aucun message à enregistrer";
  return null;
}

// ---- GET: is this conversation already classed, and how far? ---------------

export const onRequestGet: Handler = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied instanceof Response) return denied;

  const conversationId = new URL(request.url).searchParams.get("conversationId")?.trim();
  if (!conversationId) return json({ error: "Identifiant de conversation manquant" }, 400);

  try {
    const sourceId = await dataSourceId(env, env.NOTION_NOTES_DB);
    const schema = await schemaOf(env, sourceId);
    const found = await findByConversation(env, sourceId, schema, conversationId);
    if ("missing" in found) {
      return json({ error: `La base de notes n'a pas de propriété « ${found.missing} »` }, 500);
    }
    return json(found);
  } catch (error) {
    return fail(error);
  }
};

// ---- POST: create the note and write the thread into it --------------------

export const onRequestPost: Handler = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied instanceof Response) return denied;
  const { user } = denied;

  const body = (await request.json().catch(() => ({}))) as Body;
  const invalid = validate(body);
  if (invalid) return json({ error: invalid }, 400);

  const conversationId = body.conversationId!.trim();
  const messages = body.messages!;
  const contactIds = [...new Set(body.contactIds!)];

  try {
    const p = props(env);
    const sourceId = await dataSourceId(env, env.NOTION_NOTES_DB);
    const schema = await schemaOf(env, sourceId);

    // Before anything is written. A replayed send must find the page it
    // already made rather than make a second one.
    const found = await findByConversation(env, sourceId, schema, conversationId);
    if ("missing" in found) {
      return json({ error: `La base de notes n'a pas de propriété « ${found.missing} »` }, 500);
    }
    if (found.note) {
      return json({ ...found.note, messagesAdded: 0, duplicate: true });
    }

    const relation = await contactProperty(env, schema);
    const properties: Record<string, unknown> = {
      ...noteProperties(schema, p, user, messages),
      [relation]: { relation: contactIds.map((id) => ({ id })) },
      [p.noteClientId]: text(conversationId),
    };
    // Missing column or too many files: the note is still made. It is worth
    // more than its attachments, and the panel lists what did not make it.
    const files = splitFiles(schema, p.noteFile, body.files ?? [], 0);
    if (files.accepted.length) properties[p.noteFile] = { files: files.accepted.map(fileEntry) };

    const templates = await notion<{ templates?: { id: string; is_default?: boolean }[] }>(
      env,
      `/data_sources/${sourceId}/templates`,
    ).catch(() => null);
    const template = (templates?.templates ?? []).find((one) => one.is_default) ?? templates?.templates?.[0];

    const create = () =>
      notion<{ id: string; url: string }>(env, "/pages", {
        method: "POST",
        body: {
          parent: { type: "data_source_id", data_source_id: sourceId },
          properties,
          ...(template ? { template: { type: "template_id", template_id: template.id } } : {}),
        },
      });
    let page: { id: string; url: string };
    try {
      page = await create();
    } catch (error) {
      // An upload Notion no longer recognises (expired, already used) fails
      // the whole creation. The note matters more: it is made without the
      // files, and they are reported as not imported.
      if (!(error instanceof NotionError) || error.status !== 400 || !files.accepted.length) throw error;
      delete properties[p.noteFile];
      page = await create();
      files.skipped.push(
        ...files.accepted.map((file) => ({ name: file.name, reason: "Notion a refusé l'ajout à la colonne Fichiers." })),
      );
      files.accepted = [];
    }

    const templateLanded = template ? await waitForTemplate(env, page.id) : true;

    try {
      await appendThread(env, page.id, messages);
    } catch (error) {
      // A page without its messages is worse than no page at all: it looks
      // classed, it is found by the deduplication, and the next attempt
      // therefore refuses to write the thread it is missing. So it goes to the
      // trash before anyone is told, and the retry starts clean.
      //
      // Verified against the real base on 2026-10-03: a page sent to the trash
      // with `in_trash` is no longer returned by the query behind
      // findByConversation, so the deduplication does not resurrect it.
      const archived = await notion(env, `/pages/${page.id}`, { method: "PATCH", body: { in_trash: true } })
        .then(() => true)
        .catch(() => false);
      // If even that fails there is an orphan, and saying so is the only
      // honest move: a retry would then find it and skip the messages.
      return json(
        archived
          ? { error: "Les messages n'ont pas pu être écrits dans Notion. Rien n'a été laissé derrière.", retry: true }
          : {
              error: "Les messages n'ont pas pu être écrits, et la note vide n'a pas pu être supprimée. Supprime-la dans Notion avant de réessayer.",
              retry: true,
              noteUrl: page.url,
            },
        502,
      );
    }

    return json(
      {
        id: page.id,
        url: page.url,
        messagesAdded: messages.length,
        templateTimedOut: !templateLanded,
        filesAdded: files.accepted.length,
        filesSkipped: files.skipped,
      },
      201,
    );
  } catch (error) {
    return fail(error);
  }
};

// ---- PATCH: add only what is new ------------------------------------------

export const onRequestPatch: Handler = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied instanceof Response) return denied;
  const { user } = denied;

  const body = (await request.json().catch(() => ({}))) as Body;
  if (!body.noteId?.trim()) return json({ error: "Note introuvable" }, 400);
  const invalid = validate(body);
  if (invalid) return json({ error: invalid }, 400);

  const noteId = body.noteId.trim();
  const messages = body.messages!;
  const contactIds = [...new Set(body.contactIds!)];

  try {
    const p = props(env);
    const sourceId = await dataSourceId(env, env.NOTION_NOTES_DB);
    const schema = await schemaOf(env, sourceId);

    const page = await notion<{ properties: Record<string, any>; url: string }>(env, `/pages/${noteId}`);
    const mark = plainOf(page.properties[p.noteLastMessage]) || null;

    // Someone else enriched the note since the panel last looked. Writing over
    // their mark would make the next enrichment skip their messages.
    if ((body.sinceMessageId ?? null) !== mark) {
      return json(
        { error: "La note a été enrichie entre-temps.", lastMessageId: mark, url: page.url },
        409,
      );
    }

    // Everything after the mark. No mark at all — a note from before this
    // feature — and the whole thread is new: a visible duplicate in the body
    // beats a message that is never written.
    const at = mark
      ? messages.findIndex((message) => message.id === mark || message.copyIds?.includes(mark))
      : -1;
    const fresh = messages.slice(at + 1);
    if (!fresh.length) {
      return json({ id: noteId, url: page.url, messagesAdded: 0 });
    }

    await appendThread(env, noteId, fresh);

    const relation = await contactProperty(env, schema);
    const properties: Record<string, unknown> = noteProperties(schema, p, user, fresh);

    // Union, never replacement: the contacts and the authors already on the
    // note stay on it.
    const relationColumn = schema[relation];
    if (relationColumn) {
      const held = (await propertyItems(env, noteId, relationColumn.id))
        .map((item) => item.relation?.id)
        .filter(Boolean) as string[];
      properties[relation] = {
        relation: [...new Set([...held, ...contactIds])].map((id) => ({ id })),
      };
    }
    const authorColumn = schema[p.noteAuthor];
    if (authorColumn?.type === "people") {
      const held = (await propertyItems(env, noteId, authorColumn.id))
        .map((item) => item.people?.id)
        .filter(Boolean) as string[];
      properties[p.noteAuthor] = {
        people: [...new Set([...held, user.notionUserId])].map((id) => ({ object: "user", id })),
      };
    }

    // The files go in this same PATCH as the mark (see the top of the
    // attachments section). A files column is replaced, not appended to, so the
    // ones already there are sent back first — read from the page fetched at
    // the start of this request, whose file URLs are still fresh.
    const heldFiles = ((page.properties[p.noteFile]?.files ?? []) as any[]).map(heldEntry).filter(Boolean);
    const files = splitFiles(schema, p.noteFile, body.files ?? [], heldFiles.length);
    if (files.accepted.length) {
      properties[p.noteFile] = { files: [...heldFiles, ...files.accepted.map(fileEntry)] };
    }

    try {
      await notion(env, `/pages/${noteId}`, { method: "PATCH", body: { properties } });
    } catch (error) {
      // Whether Notion takes back the files it handed out is not documented
      // (research C-2). If this write is refused because of them, it is made
      // again without the column: the messages and the mark land, the files
      // already on the note are left untouched, and the new ones are reported
      // as not imported. Nothing is lost silently, nothing is duplicated.
      if (!(error instanceof NotionError) || error.status !== 400 || !files.accepted.length) throw error;
      delete properties[p.noteFile];
      await notion(env, `/pages/${noteId}`, { method: "PATCH", body: { properties } });
      files.skipped.push(
        ...files.accepted.map((file) => ({ name: file.name, reason: "Notion a refusé l'ajout à la colonne Fichiers." })),
      );
      files.accepted = [];
    }

    return json({
      id: noteId,
      url: page.url,
      messagesAdded: fresh.length,
      filesAdded: files.accepted.length,
      filesSkipped: files.skipped,
    });
  } catch (error) {
    return fail(error);
  }
};
