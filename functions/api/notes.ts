import {
  dataSourceId,
  fail,
  guard,
  isNotionId,
  json,
  notion,
  props,
  schemaOf,
  SOURCE,
  type Handler,
} from "../_lib/notion.js";
import { contactProperty, noteTemplateId } from "../_lib/notes-db.js";
import { exclusive } from "../_lib/redis.js";
import { richText } from "../_lib/thread.js";

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

export const onRequestPost: Handler = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied instanceof Response) return denied;
  const { user } = denied;

  const body = (await request.json().catch(() => ({}))) as Body;
  const transcript = body.transcript?.trim();
  if (!transcript) return json({ error: "Transcription vide" }, 400);
  if (!body.clientId) return json({ error: "Identifiant de note manquant" }, 400);
  if (body.contactId && !isNotionId(body.contactId)) return json({ error: "Contact introuvable" }, 400);

  const done = await exclusive(env, `lock:note:${body.clientId}`, async () => {
    try {
      const p = props(env);
      const sourceId = await dataSourceId(env, env.NOTION_NOTES_DB);
      const schema = await schemaOf(env, sourceId);

      // The contact relation is the one pointing at the Contacts base, whatever
      // its name ("Interlocuteur" today), unless the env names it.
      const relation = body.contactId ? await contactProperty(env, schema).catch(() => null) : null;
      if (body.contactId && !relation) return json({ error: "Aucune relation vers Contacts dans la base de notes" }, 500);

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
      if (body.contactId && relation) properties[relation] = { relation: [{ id: body.contactId }] };
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

      const templateId = await noteTemplateId(env, sourceId);
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
  });
  return done ?? json({ error: "Un envoi de cette note est déjà en cours, réessayez.", retry: true }, 409);
};
