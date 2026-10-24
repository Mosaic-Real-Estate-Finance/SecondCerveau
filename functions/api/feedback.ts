import { dataSourceId, json, notion, type Env, type Handler } from "../_lib/notion.js";
import { allowed, fromThisSite, place, who } from "./track.js";

// POST /api/auth/feedback — what a user says of the app, asked on the home
// screen after a dictation has reached Notion (src/components/feedback-banner).
// One page each in « Retours sur l'app » (NOTION_FEEDBACK_DB), beside the
// usage events and written with their integration, NOTION_EVENTS_TOKEN:
// Retour (title), Ressenti (Satisfait | Problème | Retour libre — the
// settings' open form), Commentaire, Utilisateur,
// Date, Dictée n°, Appareil, Traité.
//
// Unlike an event, the answer waits for Notion: the form says « Merci » only
// once the page exists, and offers to try again otherwise.

const DEFAULT_DB = "3b6e5845-0a92-422d-bb6f-2c170c7610d1";
const FEELINGS = { satisfied: "Satisfait", problem: "Problème", free: "Retour libre" } as const;
const MAX_TEXT = 2000;

type Body = { feeling?: string; text?: string; count?: number; device?: string; user?: string };

/** The title: the first words of the comment, or the feeling alone. */
const titleOf = (feeling: string, text: string) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line ? (line.length > 80 ? `${line.slice(0, 79)}…` : line) : feeling;
};

export const onRequestPost: Handler = async ({ request, env: app }) => {
  if (!fromThisSite(request)) return json({ error: "Origine refusée" }, 403);
  if (!app.NOTION_EVENTS_TOKEN?.trim()) return json({ error: "Retours indisponibles" }, 503);
  const body = (await request.json().catch(() => ({}))) as Body;
  const feeling = FEELINGS[body.feeling as keyof typeof FEELINGS];
  if (!feeling) return json({ error: "Réponse invalide" }, 400);
  if (!(await allowed(app, request))) return json({ error: "Trop de retours, réessayez dans une minute." }, 429);

  const text = String(body.text ?? "").slice(0, MAX_TEXT);
  const count = Number.isFinite(body.count) ? Math.max(0, Math.round(Number(body.count))) : null;
  const device = String(body.device ?? "").slice(0, 120);
  const user = await who(app, request, body.user);
  const env: Env = { ...app, NOTION_TOKEN: app.NOTION_EVENTS_TOKEN.trim() };
  try {
    const sourceId = await dataSourceId(env, env.NOTION_FEEDBACK_DB?.trim() || DEFAULT_DB);
    const rich = (content: string) => ({ rich_text: content ? [{ text: { content } }] : [] });
    await notion(env, "/pages", {
      method: "POST",
      body: {
        parent: { type: "data_source_id", data_source_id: sourceId },
        properties: {
          Retour: { title: [{ text: { content: titleOf(feeling, text) } }] },
          Ressenti: { select: { name: feeling } },
          // Notion caps one text run at 2,000 characters: the cap above.
          Commentaire: rich(text),
          Utilisateur: { select: { name: user } },
          Date: { date: { start: new Date().toISOString() } },
          ...(count !== null ? { "Dictée n°": { number: count } } : {}),
          Appareil: rich([device, place(request)].filter(Boolean).join(" · ").slice(0, 200)),
        },
      },
    });
  } catch (error) {
    const status = (error as { status?: number }).status ?? "";
    console.error(`[feedback] Notion ${status} : ${(error as Error).message ?? error}`.slice(0, 300));
    return json({ error: "Le retour n'a pas pu être enregistré. Réessayez." }, 502);
  }
  return json({ ok: true });
};
