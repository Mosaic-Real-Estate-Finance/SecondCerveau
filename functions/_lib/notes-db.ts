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

