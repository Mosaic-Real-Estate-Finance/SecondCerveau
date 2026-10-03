import { AUTH_MESSAGES, identify } from "./auth";
import { type User } from "./users";

// Thin server side layer over the Notion API. It exists for two reasons:
// the Notion API does not answer CORS preflights, so a browser cannot call it,
// and the integration token must never ship to the client.

export type Env = {
  NOTION_TOKEN: string;
  NOTION_CONTACTS_DB: string;
  NOTION_NOTES_DB: string;
  // Property names, overridable when the client renames a column in Notion.
  CONTACTS_PROP_COMPANY_ROLLUP?: string;
  CONTACTS_PROP_COMPANY_RELATION?: string;
  CONTACTS_PROP_ROLE?: string;
  CONTACTS_PROP_TYPE?: string;
  CONTACTS_PROP_CREATED?: string;
  NOTES_PROP_CONTACT?: string;
  NOTES_PROP_DATE?: string;
  NOTES_PROP_TRANSCRIPT?: string;
  NOTES_PROP_AUTHOR?: string;
  NOTES_PROP_CLIENT_ID?: string;
  NOTES_PROP_FILE?: string;
  CONTACTS_PROP_EMAIL?: string;
  NOTES_PROP_SOURCE?: string;
  NOTES_PROP_AI_STATUS?: string;
  NOTES_PROP_LAST_MESSAGE?: string;
  // The Outlook add-in. Both empty: the Microsoft token path is off and only
  // the dictation's header identifies a caller.
  ENTRA_API_CLIENT_ID?: string;
  ENTRA_TENANT_IDS?: string;
  INTERNAL_DOMAINS?: string;
};

export type Handler = (context: { request: Request; env: Env }) => Promise<Response>;

export type { User };

// https://developers.notion.com/reference/versioning
const NOTION_VERSION = "2026-03-11";
const API = "https://api.notion.com/v1";

export const props = (env: Env) => ({
  companyRollup: env.CONTACTS_PROP_COMPANY_ROLLUP || "Nom société",
  companyRelation: env.CONTACTS_PROP_COMPANY_RELATION || "Société",
  role: env.CONTACTS_PROP_ROLE || "Fonction",
  type: env.CONTACTS_PROP_TYPE || "Type",
  // Empty means "sort by the page's own created_time", which needs no column.
  created: env.CONTACTS_PROP_CREATED || "",
  // Empty: the relation of the notes base that points to the Contacts base.
  noteContact: env.NOTES_PROP_CONTACT || "",
  noteDate: env.NOTES_PROP_DATE || "Date",
  noteTranscript: env.NOTES_PROP_TRANSCRIPT || "Transcription brute",
  noteAuthor: env.NOTES_PROP_AUTHOR || "Auteur",
  noteClientId: env.NOTES_PROP_CLIENT_ID || "",
  noteFile: env.NOTES_PROP_FILE || "Fichiers",
  // The email column of the Contacts base. Several addresses fit in it,
  // separated by commas.
  contactEmail: env.CONTACTS_PROP_EMAIL || "Email",
  // Which of the two tools wrote the note: the Notion AI prompt reads it to
  // know whether the text is in a property or in the body of the page.
  noteSource: env.NOTES_PROP_SOURCE || "Source",
  noteAiStatus: env.NOTES_PROP_AI_STATUS || "Statut IA",
  noteLastMessage: env.NOTES_PROP_LAST_MESSAGE || "Dernier message",
});

/** The values written in the Source column, one per tool. */
export const SOURCE = { dictation: "Dictée", email: "Email" } as const;

export class NotionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Notion allows about 3 requests per second per integration and answers 429
// with a Retry-After in seconds; 529 means overloaded and is handled the same.
// https://developers.notion.com/reference/request-limits
export async function notion<T = any>(
  env: Env,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${API}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if ((response.status === 429 || response.status === 529) && attempt < 4) {
      const seconds = Number(response.headers.get("Retry-After")) || 2 ** attempt;
      await sleep(seconds * 1000 + Math.random() * 300);
      continue;
    }
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new NotionError(response.status, data?.message ?? `Notion ${response.status}`);
    }
    return data as T;
  }
}

// Sending the bytes of a file upload is the one Notion call that is not
// JSON: it is multipart, and the boundary has to be the one the runtime put
// in the body, so the header is left to it.
// https://developers.notion.com/reference/send-a-file-upload
export async function notionSend<T = any>(env: Env, path: string, form: FormData): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, "Notion-Version": NOTION_VERSION },
    body: form,
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new NotionError(response.status, data?.message ?? `Notion ${response.status}`);
  return data as T;
}

// What this workspace allows per file: 5 MiB on a free plan, 5 GiB on a paid
// one. Asked of Notion rather than assumed, so the message the user gets is
// the real limit.
// https://developers.notion.com/docs/working-with-files-and-media
let uploadLimit: { at: number; bytes: number } | null = null;

export async function maxUploadBytes(env: Env): Promise<number> {
  if (uploadLimit && Date.now() - uploadLimit.at < 30 * 60_000) return uploadLimit.bytes;
  const me = await notion<{ bot?: { workspace_limits?: { max_file_upload_size_in_bytes?: number } } }>(
    env,
    "/users/me",
  ).catch(() => null);
  const bytes = me?.bot?.workspace_limits?.max_file_upload_size_in_bytes || 5 * 1024 * 1024;
  uploadLimit = { at: Date.now(), bytes };
  return bytes;
}

// Queries and page creation target a data source, not the database. The env
// holds the database id (the one visible in the URL), so resolve it once per
// isolate.
const dataSources = new Map<string, string>();

export async function dataSourceId(env: Env, databaseId: string): Promise<string> {
  const cached = dataSources.get(databaseId);
  if (cached) return cached;
  const database = await notion<{ data_sources?: { id: string }[] }>(env, `/databases/${databaseId}`);
  const id = database.data_sources?.[0]?.id;
  if (!id) throw new NotionError(500, `La base ${databaseId} n'expose aucune source de données`);
  dataSources.set(databaseId, id);
  return id;
}

export type SchemaProperty = {
  id: string;
  name: string;
  type: string;
  relation?: { data_source_id?: string };
  select?: { options: { name: string }[] };
  multi_select?: { options: { name: string }[] };
};

export type Schema = Record<string, SchemaProperty>;

const schemas = new Map<string, { at: number; schema: Schema }>();

// The schema gives property ids (for filter_properties) and, for a relation,
// the data source it points to. Kept a few minutes: columns rarely change.
export async function schemaOf(env: Env, sourceId: string): Promise<Schema> {
  const cached = schemas.get(sourceId);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.schema;
  const source = await notion<{ properties: Schema }>(env, `/data_sources/${sourceId}`);
  schemas.set(sourceId, { at: Date.now(), schema: source.properties });
  return source.properties;
}

type QueryPage = { id: string; created_time: string; in_trash?: boolean; properties: Record<string, any> };

// Every page of a data source, with only the listed properties in the payload.
// https://developers.notion.com/reference/query-a-data-source
export async function queryAll(
  env: Env,
  sourceId: string,
  body: { sorts?: unknown[]; filter?: unknown },
  propertyIds: string[],
): Promise<QueryPage[]> {
  const search = propertyIds.map((id) => `filter_properties[]=${encodeURIComponent(id)}`).join("&");
  const pages: QueryPage[] = [];
  let cursor: string | undefined;
  do {
    const batch = await notion<{ results: QueryPage[]; has_more: boolean; next_cursor: string | null }>(
      env,
      `/data_sources/${sourceId}/query${search ? `?${search}` : ""}`,
      { method: "POST", body: { ...body, page_size: 100, start_cursor: cursor } },
    );
    pages.push(...batch.results);
    cursor = batch.has_more ? (batch.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return pages.filter((page) => !page.in_trash);
}

export const plain = (parts: { plain_text?: string }[] | undefined) =>
  (parts ?? []).map((part) => part.plain_text ?? "").join("").trim();

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// The single door, for every route of both tools. Who may come through is
// decided in ./auth.ts: the dictation's address header, or a verified
// Microsoft access token from the Outlook add-in.
export async function guard(request: Request, env: Env): Promise<{ user: User } | Response> {
  if (!env.NOTION_TOKEN || !env.NOTION_CONTACTS_DB || !env.NOTION_NOTES_DB) {
    return json({ error: "Configuration serveur incomplète" }, 500);
  }
  const identity = await identify(request, env);
  if ("failure" in identity) return json({ error: AUTH_MESSAGES[identity.failure] }, 401);
  return { user: identity.user };
}

export function fail(error: unknown): Response {
  if (error instanceof NotionError) {
    const message =
      error.status === 429 ? "Notion limite le nombre d'appels, réessayez dans quelques secondes." : error.message;
    // 4xx from Notion means our request or configuration is wrong, which the
    // client cannot fix by retrying; everything else is worth a retry.
    return json({ error: message, retry: error.status >= 500 || error.status === 429 }, 502);
  }
  return json({ error: "Erreur inattendue", retry: true }, 500);
}
