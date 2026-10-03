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
} from "../_lib/notion";
import { richText } from "../_lib/thread";

type Body = {
  clientId?: string;
  transcript?: string;
  contactId?: string | null;
  recordedAt?: string;
  /** References handed back by /api/files, in the order they were added. */
  files?: { id: string; name: string }[];
};

// The 2000 character splitter lives in ../_lib/thread.ts: the Outlook add-in
// needs the same one for the body of its pages, and two copies of a limit are
// one copy too many.

// The default template of the notes data source, which carries the layout and
// the blocks of a note. Notion applies it after the page is created, so the
// response comes back blank; `children` cannot be used with it.
// https://developers.notion.com/reference/post-page
async function defaultTemplateId(env: Env, sourceId: string) {
  const list = await notion<{ templates?: { id: string; is_default?: boolean }[] }>(
    env,
    `/data_sources/${sourceId}/templates`,
  ).catch(() => null);
  const templates = list?.templates ?? [];
  return (templates.find((template) => template.is_default) ?? templates[0])?.id ?? null;
}

export const onRequestPost: Handler = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied instanceof Response) return denied;
  const { user } = denied;

  const body = (await request.json().catch(() => ({}))) as Body;
  const transcript = body.transcript?.trim();
  if (!transcript) return json({ error: "Transcription vide" }, 400);
  if (!body.clientId) return json({ error: "Identifiant de note manquant" }, 400);

  try {
    const p = props(env);
    const sourceId = await dataSourceId(env, env.NOTION_NOTES_DB);
    const schema = await schemaOf(env, sourceId);

    // The contact relation is the one pointing at the Contacts base, whatever
    // its name ("Interlocuteur" today), unless the env names it.
    let contactProperty = p.noteContact;
    if (!contactProperty && body.contactId) {
      const contactsSource = await dataSourceId(env, env.NOTION_CONTACTS_DB);
      contactProperty =
        Object.values(schema).find(
          (property) => property.type === "relation" && property.relation?.data_source_id === contactsSource,
        )?.name ?? "";
      if (!contactProperty) return json({ error: "Aucune relation vers Contacts dans la base de notes" }, 500);
    }

    // With a client id column, a retry after a lost response finds the page it
    // already wrote instead of creating a duplicate.
    if (p.noteClientId && schema[p.noteClientId]) {
      const existing = await notion<{ results: { id: string; url: string }[] }>(
        env,
        `/data_sources/${sourceId}/query?filter_properties[]=${encodeURIComponent(schema[p.noteClientId].id)}`,
        {
          method: "POST",
          body: { filter: { property: p.noteClientId, rich_text: { equals: body.clientId } }, page_size: 1 },
        },
      );
      const page = existing.results[0];
      if (page) return json({ id: page.id, url: page.url, duplicate: true });
    }

    const properties: Record<string, unknown> = {};
    // The raw transcript; Notion AI writes the title, the clean text and the tags.
    if (schema[p.noteTranscript]?.type === "rich_text") {
      properties[p.noteTranscript] = { rich_text: richText(transcript) };
    } else {
      return json({ error: `La base de notes n'a pas de propriété « ${p.noteTranscript} »` }, 500);
    }
    if (body.contactId && contactProperty) properties[contactProperty] = { relation: [{ id: body.contactId }] };
    if (schema[p.noteDate]?.type === "date") {
      properties[p.noteDate] = { date: { start: (body.recordedAt ?? new Date().toISOString()).slice(0, 10) } };
    }
    // The author is the person who dictated, not the integration.
    if (schema[p.noteAuthor]?.type === "people") {
      properties[p.noteAuthor] = { people: [{ object: "user", id: user.notionUserId }] };
    }
    if (p.noteClientId && schema[p.noteClientId]) {
      properties[p.noteClientId] = { rich_text: [{ type: "text", text: { content: body.clientId } }] };
    }
    // Which tool wrote the note. The Notion AI prompt reads it to know where
    // the text is: a dictation puts it in "Transcription brute", a mail in the
    // body of the page. Conditional on the column existing, like everything
    // else this route writes — without it, the behaviour is what it was.
    if (schema[p.noteSource]?.type === "select") {
      properties[p.noteSource] = { select: { name: SOURCE.dictation } };
    }
    // Attachments are optional, so this only ever runs when the user added
    // one — and then a missing column is worth saying out loud rather than
    // dropping the file and letting them believe it reached Notion.
    const files = body.files ?? [];
    if (files.length) {
      if (schema[p.noteFile]?.type !== "files") {
        return json({ error: `La base de notes n'a pas de propriété fichier « ${p.noteFile} »` }, 500);
      }
      properties[p.noteFile] = {
        files: files.slice(0, 20).map((file) => ({
          type: "file_upload",
          name: file.name,
          file_upload: { id: file.id },
        })),
      };
    }

    const templateId = await defaultTemplateId(env, sourceId);
    const page = await notion<{ id: string; url: string }>(env, "/pages", {
      method: "POST",
      body: {
        parent: { type: "data_source_id", data_source_id: sourceId },
        properties,
        ...(templateId ? { template: { type: "template_id", template_id: templateId } } : {}),
      },
    });
    return json({ id: page.id, url: page.url });
  } catch (error) {
    return fail(error);
  }
};
