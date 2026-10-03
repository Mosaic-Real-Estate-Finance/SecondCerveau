import { createCompany } from "./companies";
import {
  dataSourceId,
  notion,
  type Schema,
  fail,
  guard,
  json,
  plain,
  props,
  queryAll,
  schemaOf,
  type Env,
  type Handler,
} from "../_lib/notion";

export type Contact = {
  id: string;
  name: string;
  company: string;
  role: string;
  // Type is a multi select in the Contacts base: a contact can be both.
  types: string[];
  // Every phone column of the base (Téléphone, Téléphone FR, Téléphone CH).
  phones: string[];
  createdAt: string;
};

// A rollup of the company name comes back as an array of title or text values.
const rollupText = (property: any): string => {
  if (!property || property.type !== "rollup") return "";
  const rollup = property.rollup;
  if (rollup?.type === "array") {
    return rollup.array
      .map((item: any) => plain(item?.[item.type]))
      .filter(Boolean)
      .join(", ");
  }
  if (rollup?.type === "string") return rollup.string ?? "";
  return "";
};

const titleOf = (properties: Record<string, any>) =>
  plain(Object.values(properties).find((property) => property?.type === "title")?.title);

// Without the rollup column, the company names come from one query on the
// companies data source (titles only), never from one call per contact.
async function companyNames(env: Env, companiesSourceId: string) {
  const schema = await schemaOf(env, companiesSourceId);
  const title = Object.values(schema).find((property) => property.type === "title");
  const pages = await queryAll(env, companiesSourceId, {}, title ? [title.id] : []);
  return new Map(pages.map((page) => [page.id, titleOf(page.properties)]));
}

// Contacts barely change during a working session: a short cache spares the
// Notion quota when several phones open the app at once.
let cache: { at: number; body: unknown } | null = null;
const TTL = 60_000;

export const onRequestGet: Handler = async ({ request, env }) => {
  const denied = guard(request, env);
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

type NewContact = {
  name?: string;
  role?: string;
  // Each number carries the country picked in the form, which decides the
  // column it lands in.
  phones?: { country?: string; dial?: string; number?: string }[];
  types?: string[];
  companyId?: string;
  newCompany?: { name: string; description?: string; site?: string; type?: string; address?: string };
};

// International form: "+33 6 12 34 56 78". A number already starting with +
// is left alone, and a national leading zero is dropped before the code.
function international(dial: string | undefined, number: string) {
  const trimmed = number.trim().replace(/\s+/g, " ");
  if (trimmed.startsWith("+") || !/^\+\d{1,4}$/.test(dial ?? "")) return trimmed;
  return `${dial} ${trimmed.replace(/^0\s?/, "")}`;
}

// One phone column per country, and a catch-all. Several numbers for the same
// country share their column, separated by a slash.
function phoneProperties(schema: Schema, phones: NonNullable<NewContact["phones"]>) {
  const columns: Record<string, string> = { FR: "Téléphone FR", CH: "Téléphone CH", other: "Téléphone" };
  const buckets: Record<string, string[]> = { FR: [], CH: [], other: [] };
  for (const phone of phones) {
    const number = phone.number?.trim();
    if (!number) continue;
    buckets[phone.country === "FR" || phone.country === "CH" ? phone.country : "other"].push(
      international(phone.dial, number),
    );
  }
  const properties: Record<string, unknown> = {};
  for (const [key, numbers] of Object.entries(buckets)) {
    const column = schema[columns[key]];
    if (!numbers.length) continue;
    // No column for that country: fall back to the generic one.
    const target = column ?? schema[columns.other];
    if (!target) continue;
    const existing = (properties[target.name] as { phone_number?: string } | undefined)?.phone_number;
    properties[target.name] = { phone_number: [existing, ...numbers].filter(Boolean).join(" / ") };
  }
  return properties;
}

export const onRequestPost: Handler = async ({ request, env }) => {
  const denied = guard(request, env);
  if (denied instanceof Response) return denied;

  const body = (await request.json().catch(() => ({}))) as NewContact;
  const name = body.name?.trim();
  if (!name) return json({ error: "Le nom est obligatoire" }, 400);

  try {
    const p = props(env);
    const sourceId = await dataSourceId(env, env.NOTION_CONTACTS_DB);
    const schema = await schemaOf(env, sourceId);

    let company = body.companyId ? { id: body.companyId, name: "", type: "" } : null;
    if (!company && body.newCompany?.name?.trim()) {
      company = await createCompany(env, { ...body.newCompany, name: body.newCompany.name.trim() });
    }

    // The title of this base has no name, so it is keyed by its id.
    const properties: Record<string, unknown> = {
      title: { title: [{ type: "text", text: { content: name } }] },
      ...phoneProperties(schema, body.phones ?? []),
    };
    if (body.role?.trim() && schema[p.role]) {
      properties[p.role] = { rich_text: [{ type: "text", text: { content: body.role.trim().slice(0, 2000) } }] };
    }
    if (body.types?.length && schema[p.type]?.type === "multi_select") {
      properties[p.type] = { multi_select: body.types.map((option) => ({ name: option })) };
    }
    if (company && schema[p.companyRelation]?.type === "relation") {
      properties[p.companyRelation] = { relation: [{ id: company.id }] };
    }

    const page = await notion<{ id: string; properties: Record<string, any> }>(env, "/pages", {
      method: "POST",
      body: { parent: { type: "data_source_id", data_source_id: sourceId }, properties },
    });

    cache = null;
    const contact: Contact = {
      id: page.id,
      name,
      company: company?.name ?? "",
      role: body.role?.trim() ?? "",
      types: body.types ?? [],
      phones: (body.phones ?? []).map((phone) => phone.number?.trim()).filter((number): number is string => !!number),
      createdAt: new Date().toISOString(),
    };
    return json({ contact });
  } catch (error) {
    return fail(error);
  }
};
