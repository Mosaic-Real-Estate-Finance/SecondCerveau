import { companyNames, rollupText, titleOf } from "../../../_lib/contact";
import {
  dataSourceId,
  fail,
  guard,
  json,
  props,
  queryAll,
  schemaOf,
  type Handler,
} from "../../../_lib/notion";

// Which participants of a mail thread are already in the Contacts base.
//
// One Notion request, whatever the number of addresses and whatever the size
// of the base. The Email column is of type `email` and holds one string, so a
// contact with several addresses keeps them there separated by commas — a
// compound `or` of `contains` narrows the base down in a single query.
//
// `contains` is a substring match, and that is the trap: searching "o@m.com"
// would find "theo@m.com". So the narrowing is only a narrowing. Every value
// that comes back is split on commas and compared for exact equality before a
// contact is called recognised.

const MAX = 100;

const clean = (address: string) => address.trim().toLowerCase();

type Matched = { id: string; name: string; company: string };

export const onRequestPost: Handler = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied instanceof Response) return denied;

  const body = (await request.json().catch(() => ({}))) as { addresses?: string[] };
  const wanted = [...new Set((body.addresses ?? []).map(clean).filter((address) => address.includes("@")))];
  if (!wanted.length) return json({ error: "Aucune adresse à rechercher" }, 400);
  if (wanted.length > MAX) return json({ error: "Trop d'adresses dans une seule requête" }, 400);

  try {
    const p = props(env);
    const sourceId = await dataSourceId(env, env.NOTION_CONTACTS_DB);
    const schema = await schemaOf(env, sourceId);

    const emailColumn = schema[p.contactEmail];
    if (!emailColumn || (emailColumn.type !== "email" && emailColumn.type !== "rich_text")) {
      return json({ error: `La base Contacts n'a pas de propriété « ${p.contactEmail} »` }, 500);
    }

    const title = Object.values(schema).find((property) => property.type === "title");
    const rollup = schema[p.companyRollup]?.type === "rollup" ? schema[p.companyRollup] : undefined;
    const relation = schema[p.companyRelation]?.type === "relation" ? schema[p.companyRelation] : undefined;
    const propertyIds = [title, emailColumn, rollup ?? relation]
      .filter((property) => property !== undefined)
      .map((property) => property.id);

    const key = emailColumn.type === "email" ? "email" : "rich_text";
    const pages = await queryAll(
      env,
      sourceId,
      { filter: { or: wanted.map((address) => ({ property: p.contactEmail, [key]: { contains: address } })) } },
      propertyIds,
    );

    const companies =
      !rollup && relation?.relation?.data_source_id
        ? await companyNames(env, relation.relation.data_source_id)
        : null;

    const matched: Record<string, Matched> = {};
    const ambiguous = new Set<string>();

    for (const page of pages) {
      const raw =
        emailColumn.type === "email"
          ? (page.properties[p.contactEmail]?.email ?? "")
          : (page.properties[p.contactEmail]?.rich_text ?? [])
              .map((part: { plain_text?: string }) => part.plain_text ?? "")
              .join("");

      const held = String(raw)
        .split(",")
        .map(clean)
        .filter(Boolean);

      const contact: Matched = {
        id: page.id,
        name: titleOf(page.properties),
        company: rollup
          ? rollupText(page.properties[p.companyRollup])
          : (page.properties[p.companyRelation]?.relation ?? [])
              .map((link: { id: string }) => companies?.get(link.id))
              .filter(Boolean)
              .join(", "),
      };

      for (const address of held) {
        // Exact equality only. This is the line that makes the substring
        // narrowing above safe.
        if (!wanted.includes(address)) continue;
        const already = matched[address];
        if (already && already.id !== page.id) {
          // Two contacts carry the same address. The base has a flaw and the
          // panel should show it rather than pick one quietly.
          ambiguous.add(address);
          continue;
        }
        matched[address] = contact;
      }
    }

    return json({
      matched,
      unknown: wanted.filter((address) => !matched[address]),
      ...(ambiguous.size ? { ambiguous: [...ambiguous] } : {}),
      // The options of the Type column, for the creation form. They come from
      // the schema already read above, so they cost nothing — reading the
      // whole contacts list to learn them would cost a great deal.
      typeOptions: schema[p.type]?.multi_select?.options?.map((option) => option.name) ?? [],
    });
  } catch (error) {
    return fail(error);
  }
};
