import { batches, blocksFor, type ThreadMessage } from "../../_lib/thread.js";
import {
  dataSourceId,
  fail,
  guard,
  json,
  notion,
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
};

const text = (content: string) => ({ rich_text: [{ type: "text", text: { content } }] });

const plainOf = (property: any) =>
  (property?.rich_text ?? []).map((part: { plain_text?: string }) => part.plain_text ?? "").join("");

/** The relation of the notes base that points at Contacts, whatever its name. */
async function contactProperty(env: Env, schema: Schema): Promise<string> {
  const named = props(env).noteContact;
  if (named) return named;
  const contactsSource = await dataSourceId(env, env.NOTION_CONTACTS_DB);
  const found = Object.values(schema).find(
    (property) => property.type === "relation" && property.relation?.data_source_id === contactsSource,
  );
  if (!found) throw new Error("Aucune relation vers Contacts dans la base de notes");
  return found.name;
}

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

/** Every id of a paginated property, which the page object truncates at 25. */
async function propertyItems(env: Env, pageId: string, propertyId: string): Promise<any[]> {
  const items: any[] = [];
  let cursor: string | undefined;
  do {
    const page = await notion<{
      results?: { type: string; relation?: { id: string }; people?: { id: string } }[];
      has_more?: boolean;
      next_cursor?: string | null;
      type?: string;
      relation?: unknown;
      people?: unknown;
    }>(
      env,
      `/pages/${pageId}/properties/${propertyId}${cursor ? `?start_cursor=${cursor}` : ""}`,
    );
    // A short property comes back whole; a long one comes back as a list.
    if (Array.isArray(page.results)) items.push(...page.results);
    else if (page.relation || page.people) items.push(page);
    cursor = page.has_more ? (page.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return items;
}

const lastOf = (messages: ThreadMessage[]) => messages[messages.length - 1];

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

    const templates = await notion<{ templates?: { id: string; is_default?: boolean }[] }>(
      env,
      `/data_sources/${sourceId}/templates`,
    ).catch(() => null);
    const template = (templates?.templates ?? []).find((one) => one.is_default) ?? templates?.templates?.[0];

    const page = await notion<{ id: string; url: string }>(env, "/pages", {
      method: "POST",
      body: {
        parent: { type: "data_source_id", data_source_id: sourceId },
        properties,
        ...(template ? { template: { type: "template_id", template_id: template.id } } : {}),
      },
    });

    const templateLanded = template ? await waitForTemplate(env, page.id) : true;

    try {
      await appendThread(env, page.id, messages);
    } catch (error) {
      // The page exists. Saying nothing would leave the user believing the
      // whole send failed, and a blind retry would then duplicate the blocks.
      return json(
        {
          error: "La note a été créée mais les messages n'ont pas pu y être ajoutés.",
          retry: true,
          noteUrl: page.url,
          noteId: page.id,
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
    const at = mark ? messages.findIndex((message) => message.id === mark) : -1;
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

    await notion(env, `/pages/${noteId}`, { method: "PATCH", body: { properties } });

    return json({ id: noteId, url: page.url, messagesAdded: fresh.length });
  } catch (error) {
    return fail(error);
  }
};
