import { later } from "../_lib/background.js";
import { readSession } from "../_lib/session.js";
import { findUser } from "../_lib/users.js";
import { dataSourceId, notion, type Env, type Handler } from "../_lib/notion.js";
import { redis } from "../_lib/redis.js";

// POST /api/auth/track — usage events, one page each in a Notion base (NOTION_EVENTS_DB): Action
// (title), Utilisateur (select), Date, Localisation (text).
//
// Silent by design: the answer goes out at once (202), before anything is
// read or written, and the page is created after it (background.ts). The
// app never waits on it and never hears of a failure. Open to visitors who
// are not signed in (the site, /welcome), so only the actions below are
// accepted, from this site, a few a minute per address.

export const ACTIONS = [
  "Le site a été ouvert",
  "Le guide /welcome a été ouvert",
  "Une dictée a été enregistrée",
  "Les notifications ont été approuvées",
  "Un utilisateur a été exclu",
  "Les notifications ont été activées",
  "Le panneau Outlook a été ouvert",
] as const;

const DEFAULT_DB = "3f9bad05-6a95-80e6-9acd-e297c22f47fd";
// The Utilisateur options; anyone else, or no one signed in, is Unknown.
const PEOPLE = ["Philippe", "Oscar", "Théo"];
const PER_MINUTE = 30;

const accepted = () => new Response(null, { status: 202 });

// Where the request came from, from the edge's own headers. Nothing precise:
// a city and a country, as Vercel resolves them from the address.
function place(request: Request): string {
  const header = (name: string) => {
    const value = request.headers.get(name);
    try {
      return value ? decodeURIComponent(value) : "";
    } catch {
      return value ?? "";
    }
  };
  return [header("x-vercel-ip-city"), header("x-vercel-ip-country-region"), header("x-vercel-ip-country")]
    .filter(Boolean)
    .join(", ");
}

async function who(env: Env, request: Request, hint: string | undefined): Promise<string> {
  // The signed-in phone; the Outlook panel, which has no cookie here, says
  // whose mailbox it is open in.
  const session = await readSession(env, request).catch(() => null);
  const name = findUser(session?.email ?? hint)?.firstName;
  return name && PEOPLE.includes(name) ? name : "Unknown";
}

async function allowed(env: Env, request: Request): Promise<boolean> {
  const address = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  try {
    const key = `track:${address}:${Math.floor(Date.now() / 60_000)}`;
    const store = redis(env);
    const count = await store.incr(key);
    if (count === 1) await store.expire(key, 120);
    return count <= PER_MINUTE;
  } catch {
    // No store: tracked all the same; this is a counter, not a gate.
    return true;
  }
}

async function record(env: Env, request: Request, action: string, hint: string | undefined) {
  if (!(await allowed(env, request))) return;
  const [user, sourceId] = await Promise.all([
    who(env, request, hint),
    dataSourceId(env, env.NOTION_EVENTS_DB?.trim() || DEFAULT_DB),
  ]);
  await notion(env, "/pages", {
    method: "POST",
    body: {
      parent: { type: "data_source_id", data_source_id: sourceId },
      properties: {
        Action: { title: [{ text: { content: action } }] },
        Utilisateur: { select: { name: user } },
        Date: { date: { start: new Date().toISOString() } },
        Localisation: { rich_text: [{ text: { content: place(request).slice(0, 200) } }] },
      },
    },
  });
}

export const onRequestPost: Handler = async ({ request, env }) => {
  // From this site only: a page elsewhere cannot fill the base.
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin && host && origin !== "null" && new URL(origin).host !== host) return accepted();

  const body = (await request.json().catch(() => ({}))) as { action?: string; user?: string };
  const action = ACTIONS.find((known) => known === body.action);
  if (!action || !env.NOTION_TOKEN) return accepted();
  later("track", record(env, request, action, body.user));
  return accepted();
};
