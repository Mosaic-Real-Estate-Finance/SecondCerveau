import { companiesSourceId, createCompany } from "../../companies.js";
import { sameCompany } from "../../../_lib/company-key.js";
import {
  companyNames,
  ContactError,
  createContact,
  emailColumn,
  phoneProperties,
  type NewContact,
} from "../../../_lib/contact.js";
import {
  dataSourceId,
  fail,
  guard,
  inDatabase,
  isNotionId,
  json,
  notion,
  props,
  schemaOf,
  type Handler,
} from "../../../_lib/notion.js";

// Creating a contact from the Outlook panel.
//
// Same creation as the dictation's, through the same shared function, with one
// difference that matters: here the address is required. A contact created
// without it would be invisible to every later recognition — the next mail
// from the same person would offer to create them a second time — so the route
// refuses rather than write a fiche that cannot be found again.
//
// /api/contacts is untouched: the dictation keeps creating contacts without an
// address, because its screens never ask for one.

export const onRequestPost: Handler = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied instanceof Response) return denied;

  const body = (await request.json().catch(() => ({}))) as NewContact;
  if (!body.name?.trim() || !body.email?.trim()) {
    return json({ error: "Nom et adresse mail requis" }, 400);
  }
  if (body.companyId && body.newCompany?.name?.trim()) {
    return json({ error: "Choisissez une société existante ou donnez-en une nouvelle" }, 400);
  }

  try {
    // Said out loud before anything is written: creating the contact and then
    // dropping its address is the one outcome worth failing for.
    if (!(await emailColumn(env))) {
      return json({ error: `La base Contacts n'a pas de propriété « ${props(env).contactEmail} »` }, 500);
    }

    // A new company is looked for first, by name with case, accents,
    // punctuation and legal form set aside: the panel's list can be a minute
    // old, and two people of one firm in the same thread would otherwise
    // create it twice. Only the name and the address are written — what the
    // signature said, as the user left it.
    let company: { id: string; name: string } | null = null;
    const wanted = body.newCompany?.name?.trim();
    if (wanted) {
      const sourceId = await companiesSourceId(env);
      company =
        sameCompany(wanted, await companyNames(env, sourceId)) ??
        (await createCompany(env, { name: wanted, address: body.newCompany?.address }));
    }

    const contact = await createContact(env, {
      ...body,
      ...(company ? { companyId: company.id, newCompany: undefined } : {}),
    });
    return json(
      {
        id: contact.id,
        name: contact.name,
        company: company?.name ?? contact.company,
        companyId: company?.id ?? body.companyId,
      },
      201,
    );
  } catch (error) {
    if (error instanceof ContactError) return json({ error: error.message }, 400);
    return fail(error);
  }
};

// ---- PATCH: numbers added to a fiche, never replaced -------------------------

type Phones = { id?: string; phones?: { country?: string; dial?: string; number?: string }[] };

const MAX_PHONES = 10;

// Digits in international form, so "06 12 34 56 78" already in the FR column
// and "+33 6 12 34 56 78" from a signature are one number. A national number
// takes the code of the column it sits in; in the catch-all it is compared as
// written.
const DIAL_OF_COLUMN: Record<string, string> = { "Téléphone FR": "33", "Téléphone CH": "41" };
function phoneKey(raw: string, column: string) {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (raw.trim().startsWith("+")) return digits;
  if (digits.startsWith("00")) return digits.slice(2);
  const dial = DIAL_OF_COLUMN[column];
  return dial && digits.startsWith("0") ? `${dial}${digits.slice(1)}` : digits;
}

/**
 * Adds numbers read in a signature to a contact already in the base, after
 * the user ticked them. What the fiche holds is kept as it is; a number it
 * already has, in any spelling, is not added again.
 */
export const onRequestPatch: Handler = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied instanceof Response) return denied;

  const body = (await request.json().catch(() => ({}))) as Phones;
  const id = body.id?.trim();
  if (!isNotionId(id)) return json({ error: "Contact introuvable" }, 400);
  const phones = (body.phones ?? []).filter((phone) => phone?.number?.trim());
  if (!phones.length) return json({ error: "Aucun numéro à ajouter" }, 400);
  if (phones.length > MAX_PHONES) return json({ error: "Trop de numéros dans une seule requête" }, 400);

  try {
    const sourceId = await dataSourceId(env, env.NOTION_CONTACTS_DB);
    const page = await notion<{
      properties: Record<string, any>;
      parent?: { database_id?: string; data_source_id?: string };
    }>(env, `/pages/${id}`);
    // Any page the integration can see is not a contact.
    if (!inDatabase(page, env.NOTION_CONTACTS_DB, sourceId)) return json({ error: "Contact introuvable" }, 404);
    const schema = await schemaOf(env, sourceId);

    const properties: Record<string, { phone_number: string }> = {};
    let added = 0;
    for (const phone of phones) {
      // The same column and the same written form a creation would use.
      const [column, value] = Object.entries(phoneProperties(schema, [phone]))[0] ?? [];
      const number = (value as { phone_number?: string } | undefined)?.phone_number;
      if (!column || !number) continue;
      const held = properties[column]?.phone_number ?? page.properties[column]?.phone_number ?? "";
      const known = held
        .split("/")
        .map((one: string) => phoneKey(one, column))
        .filter(Boolean);
      if (known.includes(phoneKey(number, column))) continue;
      properties[column] = { phone_number: [held.trim(), number].filter(Boolean).join(" / ") };
      added += 1;
    }

    if (added) await notion(env, `/pages/${id}`, { method: "PATCH", body: { properties } });
    return json({ added });
  } catch (error) {
    return fail(error);
  }
};
