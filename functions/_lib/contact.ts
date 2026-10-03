import { createCompany } from "../api/companies.js";
import {
  dataSourceId,
  notion,
  plain,
  props,
  queryAll,
  schemaOf,
  type Env,
  type Schema,
} from "./notion.js";

// Reading and writing a contact, shared by the dictation and the Outlook
// add-in.
//
// It lives here rather than in either route because a contact created from one
// tool has to be exactly the contact the other tool reads back — the phone
// columns, the company link, the title with no name. Two copies of this would
// drift, and the place they would drift is the client's own CRM.

export type Contact = {
  id: string;
  name: string;
  company: string;
  role: string;
  /** Type is a multi select in the Contacts base: a contact can be both. */
  types: string[];
  /** Every phone column of the base (Téléphone, Téléphone FR, Téléphone CH). */
  phones: string[];
  createdAt: string;
};

export type NewContact = {
  name?: string;
  /**
   * One address at creation. Several can live in the column afterwards,
   * separated by commas — the column is of type `email` and stores whatever
   * string it is given, which is what makes recognition on any of a contact's
   * addresses possible.
   */
  email?: string;
  role?: string;
  // Each number carries the country picked in the form, which decides the
  // column it lands in.
  phones?: { country?: string; dial?: string; number?: string }[];
  types?: string[];
  companyId?: string;
  newCompany?: { name: string; description?: string; site?: string; type?: string; address?: string };
};

export const titleOf = (properties: Record<string, any>) =>
  plain(Object.values(properties).find((property) => property?.type === "title")?.title);

/** A rollup of the company name comes back as an array of title or text values. */
export const rollupText = (property: any): string => {
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

// Without the rollup column, the company names come from one query on the
// companies data source (titles only), never from one call per contact.
export async function companyNames(env: Env, companiesSourceId: string) {
  const schema = await schemaOf(env, companiesSourceId);
  const title = Object.values(schema).find((property) => property.type === "title");
  const pages = await queryAll(env, companiesSourceId, {}, title ? [title.id] : []);
  return new Map(pages.map((page) => [page.id, titleOf(page.properties)]));
}

// International form: "+33 6 12 34 56 78". A number already starting with +
// is left alone, and a national leading zero is dropped before the code.
function international(dial: string | undefined, number: string) {
  const trimmed = number.trim().replace(/\s+/g, " ");
  if (trimmed.startsWith("+") || !/^\+\d{1,4}$/.test(dial ?? "")) return trimmed;
  return `${dial} ${trimmed.replace(/^0\s?/, "")}`;
}

// One phone column per country, and a catch-all. Several numbers for the same
// country share their column, separated by a slash.
export function phoneProperties(schema: Schema, phones: NonNullable<NewContact["phones"]>) {
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

export class ContactError extends Error {}

/**
 * Creates the contact, and its company if the form gave a new one.
 *
 * `email` is written when it is given and the column exists. The Outlook panel
 * always gives one, because a contact created without its address would be
 * invisible to every later recognition — so for that caller the route refuses
 * rather than create a contact that cannot be found again.
 */
export async function createContact(env: Env, body: NewContact): Promise<Contact> {
  const name = body.name?.trim();
  if (!name) throw new ContactError("Le nom est obligatoire");

  const p = props(env);
  const sourceId = await dataSourceId(env, env.NOTION_CONTACTS_DB);
  const schema = await schemaOf(env, sourceId);

  let company = body.companyId ? { id: body.companyId, name: "", type: "" } : null;
  if (!company && body.newCompany?.name?.trim()) {
    company = await createCompany(env, { ...body.newCompany, name: body.newCompany.name.trim() });
  }

  // The title of this base has no name, so it is keyed by its type.
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
  const email = body.email?.trim().toLowerCase();
  if (email && schema[p.contactEmail]?.type === "email") {
    properties[p.contactEmail] = { email };
  }

  const page = await notion<{ id: string }>(env, "/pages", {
    method: "POST",
    body: { parent: { type: "data_source_id", data_source_id: sourceId }, properties },
  });

  return {
    id: page.id,
    name,
    company: company?.name ?? "",
    role: body.role?.trim() ?? "",
    types: body.types ?? [],
    phones: (body.phones ?? []).map((phone) => phone.number?.trim()).filter((number): number is string => !!number),
    createdAt: new Date().toISOString(),
  };
}

/** Whether the Contacts base can hold an address at all. */
export async function emailColumn(env: Env): Promise<string | null> {
  const p = props(env);
  const schema = await schemaOf(env, await dataSourceId(env, env.NOTION_CONTACTS_DB));
  return schema[p.contactEmail]?.type === "email" || schema[p.contactEmail]?.type === "rich_text"
    ? p.contactEmail
    : null;
}
