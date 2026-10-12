import { randomBytes, timingSafeEqual } from "node:crypto";
import { mailEnabled, sendPlain } from "./mail.js";
import type { Env } from "./notion.js";
import { redis } from "./redis.js";
import type { User } from "./users.js";

// When transcription stops for a reason only the account owner can fix — the
// Soniox credit runs out, its key is refused — the app does not show the
// reason to its users. It reports it here, and the owner gets one mail:
// what happened, who it happened to, when. Every user who meets it meanwhile
// is noted, and the mail carries a link that, once it is fixed, tells each
// of them so.
//
// One mail per outage, not one per attempt: the alert holds for a day, or
// until the link says it is over. The users' addresses live in the
// operational store for that time only (constitution II).

export type OutageReason = "balance" | "key" | "config";

const WHAT: Record<OutageReason, string> = {
  balance: "Un enregistrement a échoué : le crédit Soniox est épuisé.",
  key: "Un enregistrement a échoué : Soniox a refusé la clé du compte.",
  config: "Un enregistrement a échoué : la transcription n'est pas configurée sur le serveur (SONIOX_API_KEY).",
};

const KEYS = { alert: "stt:outage", affected: "stt:outage:users" };
const HOLD = 24 * 3600;

const owner = (env: Env) => env.STT_ALERT_EMAIL?.trim() || "theo@gouman.fr";

const stamp = (date: Date) =>
  date.toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "long", timeStyle: "short" });

export const isOutageReason = (value: unknown): value is OutageReason =>
  value === "balance" || value === "key" || value === "config";

/** Notes the user, and mails the owner if this outage has not been reported yet. */
export async function reportOutage(env: Env, user: User, reason: OutageReason, origin: string): Promise<void> {
  const store = redis(env);
  await store.multi().sadd(KEYS.affected, user.email).expire(KEYS.affected, HOLD).exec();
  const id = randomBytes(24).toString("base64url");
  const first = await store.set(KEYS.alert, id, { nx: true, ex: HOLD });
  if (first !== "OK") return;
  if (!mailEnabled(env)) {
    console.error("[stt] panne de transcription, SMTP non configuré : aucune alerte envoyée");
    return;
  }
  console.info(`[stt] panne de transcription signalée (${reason})`);
  await sendPlain(
    env,
    owner(env),
    "Mosaic : la transcription est bloquée",
    [
      WHAT[reason],
      "",
      `Qui : ${user.firstName} (${user.email})`,
      `Quand : ${stamp(new Date())}`,
      "",
      "Aucune autre alerte ne partira pour cette panne.",
      "",
      "Une fois réglé, prévenez les personnes concernées :",
      `${origin}/api/auth/stt-resolved?t=${id}`,
    ].join("\n"),
  );
}

async function holds(env: Env, token: string | null): Promise<boolean> {
  if (!token) return false;
  const held = await redis(env).get<string>(KEYS.alert);
  if (!held) return false;
  const given = Buffer.from(token);
  return given.length === held.length && timingSafeEqual(given, Buffer.from(held));
}

const page = (title: string, body: string) =>
  new Response(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;color:#020342;max-width:420px;margin:15vh auto;padding:0 16px}button{font:inherit;font-weight:600;color:#fff;background:#000082;border:0;border-radius:999px;padding:12px 20px;cursor:pointer}</style>
</head><body><h1 style="font-weight:600;font-size:22px">${title}</h1>${body}</body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );

/**
 * The link of the alert mail. A GET only shows a button: mail clients and
 * their link scanners open links on their own, and that must not tell
 * anyone anything. The button POSTs.
 */
export async function resolvePage(env: Env, token: string | null): Promise<Response> {
  if (!(await holds(env, token))) return page("Rien à signaler", "<p>Cette panne est déjà close, ou le lien a expiré.</p>");
  const count = (await redis(env).scard(KEYS.affected)) || 0;
  return page(
    "La transcription fonctionne de nouveau ?",
    `<p>${count} personne${count > 1 ? "s" : ""} attend${count > 1 ? "ent" : ""} d'être prévenue${count > 1 ? "s" : ""}.</p>
<form method="post"><input type="hidden" name="t" value="${token}"><button type="submit">Oui, prévenir</button></form>`,
  );
}

/** Mails everyone the outage reached, then closes it. */
export async function resolveOutage(env: Env, token: string | null): Promise<Response> {
  if (!(await holds(env, token))) return page("Rien à signaler", "<p>Cette panne est déjà close, ou le lien a expiré.</p>");
  const store = redis(env);
  const people = (await store.smembers(KEYS.affected)) ?? [];
  await store.del(KEYS.alert, KEYS.affected);
  if (mailEnabled(env)) {
    await Promise.all(
      people.map((to) =>
        sendPlain(
          env,
          to,
          "Mosaic : la transcription fonctionne de nouveau",
          [
            "Bonjour,",
            "",
            "Le problème de transcription est réglé : vous pouvez de nouveau dicter vos notes.",
          ].join("\n"),
        ).catch(() => undefined),
      ),
    );
  }
  return page("C'est fait", `<p>${people.length} personne${people.length > 1 ? "s" : ""} prévenue${people.length > 1 ? "s" : ""}.</p>`);
}
