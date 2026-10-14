import { dataSourceId, notion, props, type Env, type Schema } from "./notion.js";

// Two readings of the notes base that more than one tool needs: which
// relation points at Contacts, and the whole of a relation or people property.
// They lived in the Outlook route until the Read AI sync needed them too;
// moved here unchanged.

/** The relation of the notes base that points at Contacts, whatever its name. */
export async function contactProperty(env: Env, schema: Schema): Promise<string> {
  const named = props(env).noteContact;
  if (named) return named;
  const contactsSource = await dataSourceId(env, env.NOTION_CONTACTS_DB);
  const found = Object.values(schema).find(
    (property) => property.type === "relation" && property.relation?.data_source_id === contactsSource,
  );
  if (!found) throw new Error("Aucune relation vers Contacts dans la base de notes");
  return found.name;
}

// The default template of the notes data source, which carries the layout of
// a note when no template is configured (noteTemplateId below). Read once per isolate every five minutes rather than on every note.
// https://developers.notion.com/reference/post-page
const templates = new Map<string, { at: number; id: string | null }>();

export async function defaultTemplateId(env: Env, sourceId: string): Promise<string | null> {
  const cached = templates.get(sourceId);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.id;
  const list = await notion<{ templates?: { id: string; is_default?: boolean }[] }>(
    env,
    `/data_sources/${sourceId}/templates`,
  ).catch(() => null);
  if (!list) return null;
  const all = list.templates ?? [];
  const id = (all.find((template) => template.is_default) ?? all[0])?.id ?? null;
  templates.set(sourceId, { at: Date.now(), id });
  return id;
}

// The template a note is created from: NOTION_NOTES_TEMPLATE, the page the
// team keeps for it, when it is one of the notes base's templates. A template
// of another base, or one deleted since, would fail the creation and lose the
// note: the default template is used instead, and the reason logged.
const normalise = (id: string) => id.replace(/-/g, "").toLowerCase();

export async function noteTemplateId(env: Env, sourceId: string): Promise<string | null> {
  const wanted = env.NOTION_NOTES_TEMPLATE?.trim();
  if (!wanted) return defaultTemplateId(env, sourceId);
  const cached = configured.get(sourceId);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.id ?? defaultTemplateId(env, sourceId);
  const list = await notion<{ templates?: { id: string }[] }>(env, `/data_sources/${sourceId}/templates`).catch(
    () => null,
  );
  // Unreadable list: the configured id is trusted rather than dropped.
  if (!list) return wanted;
  const found = list.templates?.find((template) => normalise(template.id) === normalise(wanted))?.id ?? null;
  if (!found) console.warn("[notes] NOTION_NOTES_TEMPLATE n'est pas un modèle de la base de notes : modèle par défaut");
  configured.set(sourceId, { at: Date.now(), id: found });
  return found ?? defaultTemplateId(env, sourceId);
}
const configured = new Map<string, { at: number; id: string | null }>();

/** Every id of a paginated property, which the page object truncates at 25. */
export async function propertyItems(env: Env, pageId: string, propertyId: string): Promise<any[]> {
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

