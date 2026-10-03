import {
  companyNames,
  ContactError,
  createContact,
  rollupText,
  titleOf,
  type Contact,
  type NewContact,
} from "../_lib/contact";
import { dataSourceId, fail, guard, json, plain, props, queryAll, schemaOf, type Handler } from "../_lib/notion";

export type { Contact };

// Contacts barely change during a working session: a short cache spares the
// Notion quota when several phones open the app at once.
let cache: { at: number; body: unknown } | null = null;
const TTL = 60_000;

export const onRequestGet: Handler = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied instanceof Response) return denied;
  if (cache && Date.now() - cache.at < TTL && !new URL(request.url).searchParams.has("fresh")) {
    return json(cache.body);
  }

  try {
    const p = props(env);
    const sourceId = await dataSourceId(env, env.NOTION_CONTACTS_DB);
    const schema = await schemaOf(env, sourceId);

    const title = Object.values(schema).find((property) => property.type === "title");
    const rollup = schema[p.companyRollup]?.type === "rollup" ? schema[p.companyRollup] : undefined;
    const relation = schema[p.companyRelation]?.type === "relation" ? schema[p.companyRelation] : undefined;
    const phoneColumns = Object.values(schema).filter((property) => property.type === "phone_number");
    const wanted = [
      title,
      rollup ?? relation,
      schema[p.role],
      schema[p.type],
      p.created ? schema[p.created] : undefined,
      ...phoneColumns,
    ];
    const propertyIds = wanted.filter((property) => property !== undefined).map((property) => property.id);

    const sorts = p.created
      ? [{ property: p.created, direction: "descending" }]
      : [{ timestamp: "created_time", direction: "descending" }];
    const pages = await queryAll(env, sourceId, { sorts }, propertyIds);

    const companies =
      !rollup && relation?.relation?.data_source_id
        ? await companyNames(env, relation.relation.data_source_id)
        : null;

    const contacts: Contact[] = pages.map((page) => {
      const properties = page.properties;
      const created = p.created ? properties[p.created]?.date?.start : null;
      return {
        id: page.id,
        name: titleOf(properties),
        company: rollup
          ? rollupText(properties[p.companyRollup])
          : (properties[p.companyRelation]?.relation ?? [])
              .map((link: { id: string }) => companies?.get(link.id))
              .filter(Boolean)
              .join(", "),
        role: plain(properties[p.role]?.rich_text),
        types: properties[p.type]?.multi_select?.map((option: { name: string }) => option.name)
          ?? (properties[p.type]?.select?.name ? [properties[p.type].select.name] : []),
        phones: phoneColumns
          .map((column) => properties[column.name]?.phone_number as string | null)
          .filter((phone): phone is string => !!phone),
        createdAt: created ?? page.created_time,
      };
    });

    const body = {
      contacts: contacts.filter((contact) => contact.name),
      rollup: !!rollup,
      // The Type options, for the creation form.
      typeOptions: schema[p.type]?.multi_select?.options?.map((option) => option.name) ?? [],
    };
    cache = { at: Date.now(), body };
    return json(body);
  } catch (error) {
    return fail(error);
  }
};

// ---- Creating a contact -----------------------------------------------------

export const onRequestPost: Handler = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied instanceof Response) return denied;

  try {
    const contact = await createContact(env, (await request.json().catch(() => ({}))) as NewContact);
    cache = null;
    return json({ contact });
  } catch (error) {
    if (error instanceof ContactError) return json({ error: error.message }, 400);
    return fail(error);
  }
};
