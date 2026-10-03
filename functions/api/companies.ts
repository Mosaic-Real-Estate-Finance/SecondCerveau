import {
  dataSourceId,
  fail,
  guard,
  json,
  notion,
  plain,
  props,
  queryAll,
  schemaOf,
  type Env,
  type Handler,
} from "../_lib/notion";

export type Company = { id: string; name: string; type: string };

// The companies base is not configured: it is the one the Société relation of
// the Contacts base points at.
export async function companiesSourceId(env: Env) {
  const contacts = await dataSourceId(env, env.NOTION_CONTACTS_DB);
  const schema = await schemaOf(env, contacts);
  const relation = schema[props(env).companyRelation];
  const id = relation?.relation?.data_source_id;
  if (!id) throw new Error("La base Contacts n'a pas de relation Société");
  return id;
}

const titleOf = (properties: Record<string, any>) =>
  plain(Object.values(properties).find((property) => property?.type === "title")?.title);

let cache: { at: number; body: unknown } | null = null;
const TTL = 60_000;

export const onRequestGet: Handler = async ({ request, env }) => {
  const denied = guard(request, env);
  if (denied instanceof Response) return denied;
  if (cache && Date.now() - cache.at < TTL) return json(cache.body);

  try {
    const sourceId = await companiesSourceId(env);
    const schema = await schemaOf(env, sourceId);
    const title = Object.values(schema).find((property) => property.type === "title");
    const type = Object.values(schema).find((property) => property.type === "select");
    const pages = await queryAll(
      env,
      sourceId,
      { sorts: [{ timestamp: "created_time", direction: "descending" }] },
      [title?.id, type?.id].filter((id): id is string => !!id),
    );
    const companies: Company[] = pages
      .map((page) => ({
        id: page.id,
        name: titleOf(page.properties),
        type: (type && page.properties[type.name]?.select?.name) || "",
      }))
      .filter((company) => company.name);

    const body = { companies, typeOptions: type?.select?.options?.map((option) => option.name) ?? [] };
    cache = { at: Date.now(), body };
    return json(body);
  } catch (error) {
    return fail(error);
  }
};

type NewCompany = { name?: string; description?: string; site?: string; type?: string; address?: string };

export const onRequestPost: Handler = async ({ request, env }) => {
  const denied = guard(request, env);
  if (denied instanceof Response) return denied;

  const body = (await request.json().catch(() => ({}))) as NewCompany;
  const name = body.name?.trim();
  if (!name) return json({ error: "Le nom de la société est obligatoire" }, 400);

  try {
    const page = await createCompany(env, body as NewCompany & { name: string });
    cache = null;
    return json(page);
  } catch (error) {
    return fail(error);
  }
};

// Shared with the contact endpoint, which can create a company in the same go.
export async function createCompany(env: Env, body: NewCompany & { name: string }): Promise<Company> {
  const sourceId = await companiesSourceId(env);
  const schema = await schemaOf(env, sourceId);
  const byType = (type: string) => Object.values(schema).find((property) => property.type === type);

  const text = (value?: string) =>
    value?.trim() ? { rich_text: [{ type: "text", text: { content: value.trim().slice(0, 2000) } }] } : null;

  const properties: Record<string, unknown> = { title: { title: [{ type: "text", text: { content: body.name } }] } };
  const description = schema["Description"] && text(body.description);
  if (description) properties["Description"] = description;
  const address = schema["Adresse"] && text(body.address);
  if (address) properties["Adresse"] = address;
  if (body.site?.trim() && schema["Site Internet"]) {
    properties["Site Internet"] = { url: normaliseUrl(body.site) };
  }
  const typeProperty = schema["Type"] ?? byType("select");
  if (body.type?.trim() && typeProperty?.type === "select") {
    properties[typeProperty.name] = { select: { name: body.type.trim() } };
  }

  const page = await notion<{ id: string }>(env, "/pages", {
    method: "POST",
    body: { parent: { type: "data_source_id", data_source_id: sourceId }, properties },
  });
  return { id: page.id, name: body.name, type: body.type ?? "" };
}

// Notion rejects a url property without a scheme.
export const normaliseUrl = (value: string) => {
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};
