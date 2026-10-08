import { companyNames, rollupText, titleOf } from "../contact.js";
import { dataSourceId, props, queryAll, schemaOf, type Env } from "../notion.js";
import { domainOf } from "./participants.js";

// Which externals of a meeting are already contacts — and, for the others,
// which companies their domain points to (brief §5.4).
//
// Same pattern as functions/api/outlook/contacts/match.ts, verified there on
// the real base: one query, a compound `or` of `contains` on the Email column,
// then strict equality in code. `contains` is a substring match, so
// "o@m.com" would find "theo@m.com"; the narrowing is only a narrowing.
//
// The domains ride on the same query: "@gouman.fr" as one more `contains`
// brings back every contact of that domain, from which the suggestion is read.
// One request, whatever the number of participants or the size of the base.

/** Mail providers, not companies: a shared domain there says nothing. */
export const GENERIC_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "outlook.fr",
  "hotmail.com",
  "hotmail.fr",
  "live.com",
  "live.fr",
  "msn.com",
  "yahoo.com",
  "yahoo.fr",
  "icloud.com",
  "me.com",
  "mac.com",
  "orange.fr",
  "wanadoo.fr",
  "free.fr",
  "sfr.fr",
  "neuf.fr",
  "laposte.net",
  "bbox.fr",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "gmx.com",
  "gmx.fr",
];

export const genericDomains = (env: Env) => {
  const custom = (env.GENERIC_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
  return new Set(custom.length ? custom : GENERIC_DOMAINS);
};

export type ContactRef = { id: string; name: string; company: string };
export type CompanyRef = { id: string; name: string };

export type MatchResult =
  | { status: "recognized"; contact: ContactRef }
  | { status: "ambiguous"; candidates: ContactRef[] }
  | { status: "unknown"; companies: CompanyRef[] };

/** A contact as the query returns it, reduced to what matching reads. */
export type Row = { id: string; name: string; emails: string[]; companies: CompanyRef[] };

/** Every address held in the column, split on commas, lowercased. */
export const addressesOf = (raw: string) =>
  raw
    .split(",")
    .map((address) => address.trim().toLowerCase())
    .filter(Boolean);

/**
 * The decision, apart from Notion so it can be tested on its own.
 *
 * Exact address first: one contact recognises, two make an ambiguity the
 * user settles. Then the domain — compared strictly on what follows the @,
 * never on a company's website — and every company of every contact of that
 * domain is offered, so a holding and its subsidiary both show.
 */
export function decide(wanted: string[], rows: Row[], generic: Set<string>): Record<string, MatchResult> {
  const results: Record<string, MatchResult> = {};
  const describe = (row: Row): ContactRef => ({
    id: row.id,
    name: row.name,
    company: row.companies.map((company) => company.name).filter(Boolean).join(", "),
  });
  for (const email of wanted) {
    const exact = rows.filter((row) => row.emails.includes(email));
    if (exact.length === 1) {
      results[email] = { status: "recognized", contact: describe(exact[0]) };
      continue;
    }
    if (exact.length > 1) {
      results[email] = { status: "ambiguous", candidates: exact.map(describe) };
      continue;
    }
    const domain = domainOf(email);
    const companies = new Map<string, CompanyRef>();
    if (!generic.has(domain)) {
      for (const row of rows) {
        if (!row.emails.some((held) => domainOf(held) === domain)) continue;
        for (const company of row.companies) companies.set(company.id, company);
      }
    }
    results[email] = { status: "unknown", companies: [...companies.values()] };
  }
  return results;
}

// Notion caps a compound filter at 100 conditions. A meeting never comes
// close, but the cap is the API's, so the query is cut rather than refused.
const CONDITIONS = 100;

export async function matchExternals(env: Env, emails: string[]): Promise<Record<string, MatchResult>> {
  const wanted = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter((email) => email.includes("@")))];
  if (!wanted.length) return {};
  const generic = genericDomains(env);

  const p = props(env);
  const sourceId = await dataSourceId(env, env.NOTION_CONTACTS_DB);
  const schema = await schemaOf(env, sourceId);
  const emailColumn = schema[p.contactEmail];
  if (!emailColumn || (emailColumn.type !== "email" && emailColumn.type !== "rich_text")) {
    throw new Error(`La base Contacts n'a pas de propriété « ${p.contactEmail} »`);
  }
  const title = Object.values(schema).find((property) => property.type === "title");
  const rollup = schema[p.companyRollup]?.type === "rollup" ? schema[p.companyRollup] : undefined;
  const relation = schema[p.companyRelation]?.type === "relation" ? schema[p.companyRelation] : undefined;
  const propertyIds = [title, emailColumn, relation, rollup]
    .filter((property) => property !== undefined)
    .map((property) => property.id);

  const key = emailColumn.type === "email" ? "email" : "rich_text";
  const needles = [
    ...wanted,
    ...[...new Set(wanted.map(domainOf))].filter((domain) => !generic.has(domain)).map((domain) => `@${domain}`),
  ];
  const pages = [];
  for (let at = 0; at < needles.length; at += CONDITIONS) {
    const slice = needles.slice(at, at + CONDITIONS);
    pages.push(
      ...(await queryAll(
        env,
        sourceId,
        { filter: { or: slice.map((needle) => ({ property: p.contactEmail, [key]: { contains: needle } })) } },
        propertyIds,
      )),
    );
  }

  // Company names: the relation gives ids, and the names come from one query
  // on the companies base — the rollup "Nom société" does not exist in the
  // real schema (feature 001, research A-3).
  const names =
    relation?.relation?.data_source_id && pages.length
      ? await companyNames(env, relation.relation.data_source_id)
      : null;

  const seen = new Set<string>();
  const rows: Row[] = [];
  for (const page of pages) {
    if (seen.has(page.id)) continue;
    seen.add(page.id);
    const raw =
      key === "email"
        ? (page.properties[p.contactEmail]?.email ?? "")
        : (page.properties[p.contactEmail]?.rich_text ?? [])
            .map((part: { plain_text?: string }) => part.plain_text ?? "")
            .join("");
    const ids: string[] = (page.properties[p.companyRelation]?.relation ?? []).map((link: { id: string }) => link.id);
    const rolled = rollup ? rollupText(page.properties[p.companyRollup]) : "";
    rows.push({
      id: page.id,
      name: titleOf(page.properties),
      emails: addressesOf(String(raw)),
      companies: ids.map((id, index) => ({
        id,
        name: names?.get(id) ?? (index === 0 ? rolled : ""),
      })),
    });
  }
  return decide(wanted, rows, generic);
}
